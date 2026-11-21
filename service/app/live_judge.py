"""Juez en directo: el veredicto del vídeo que se está viendo (panel de etiquetado).

1. Reglas fijas de la política (`apply_rules`): si aplican, veredicto sin llamar al modelo.
2. Si no, el juez configurado (`LiveSettings`) con la política guardada. Usa la misma caché
   que la ablación (`verdicts`, clave video/judge/model/config/policy_version), así que ver un
   vídeo dos veces no se paga dos veces.
3. Antes de llamar, espera un poco (`live_wait_s`) a los niveles asíncronos que pide la
   configuración (L2 canal, L4 fotogramas). Si no llegan, decide con lo que haya y guarda el
   veredicto con la config `<config>~partial`, que la ablación nunca lee.

Fuga de información: cada vez que el servicio devuelve un veredicto visible lo anota en
`verdict_exposures`; una etiqueta puesta después queda con `verdict_seen_before_label`.
"""

import asyncio
import contextlib
import time
from collections.abc import Awaitable, Callable
from typing import Literal

from pydantic import BaseModel, field_validator

from app import db
from app.judges.base import Judge
from app.judges.registry import JUDGES
from app.models import FichaOut, InfoLevel, Label, Verdict, build_ficha_view
from app.policy import Policy
from app.rules import RuleId, apply_rules
from eval import ablation
from eval.configs import CONFIG_LEVELS, config_levels

SETTINGS_KEY = "live"
PARTIAL_SUFFIX = "~partial"
LIVE_MAX_RETRIES = 2

Reveal = Literal["after_label", "always"]
VerdictSource = Literal["rule", "model"]


class LiveSettings(BaseModel):
    judge: str = "liquid/d1.2-ultra"
    config: str = "D"  # A–F (sin +L0: el historial sin validación temporal ensuciaría la caché)
    reveal: Reveal = "after_label"

    @field_validator("judge")
    @classmethod
    def _known_judge(cls, value: str) -> str:
        if value not in JUDGES:
            raise ValueError(f"unknown judge {value!r}; available: {', '.join(JUDGES)}")
        return value

    @field_validator("config")
    @classmethod
    def _known_config(cls, value: str) -> str:
        if value not in CONFIG_LEVELS:
            raise ValueError(f"unknown config {value!r}; use {', '.join(CONFIG_LEVELS)}")
        return value


class LiveVerdict(BaseModel):
    """Respuesta de `/verdicts/{video_id}`. Oculto (`revealed=false`): sin etiqueta ni
    probabilidades (reveal="after_label" y el vídeo aún no está etiquetado)."""

    video_id: str
    revealed: bool
    reveal: Reveal
    label: Label | None = None
    confidence: float | None = None
    probs: dict[Label, float] | None = None
    source: VerdictSource | None = None
    rule: RuleId | None = None
    reason: str | None = None
    judge: str
    config: str
    partial: bool = False  # faltaban niveles (L2/L4) al decidir
    cached: bool = False
    cost_usd: float = 0.0  # coste de esta petición (0 si viene de caché o de una regla)
    latency_ms: int = 0
    policy_version: str


def load_live_settings(database: db.Database) -> LiveSettings:
    with database.connect() as conn:
        stored = db.get_setting(conn, SETTINGS_KEY)
    if not isinstance(stored, dict):
        return LiveSettings()
    try:
        return LiveSettings.model_validate(stored)
    except ValueError:
        return LiveSettings()  # ajustes de una versión anterior: valores por defecto


def save_live_settings(database: db.Database, settings: LiveSettings) -> LiveSettings:
    with database.connect() as conn:
        db.put_setting(conn, SETTINGS_KEY, settings.model_dump())
    return settings


def missing_levels(ficha: FichaOut, config: str) -> list[InfoLevel]:
    """Niveles asíncronos que pide la config y aún están pendientes."""
    levels = config_levels(config)
    missing = []
    if InfoLevel.L2 in levels and ficha.levels.L2 == "pending":
        missing.append(InfoLevel.L2)
    if InfoLevel.L4 in levels and ficha.levels.L4 == "pending":
        missing.append(InfoLevel.L4)
    return missing


class LiveJudge:
    """Calcula (y cachea) veredictos del juez en directo. Un candado por vídeo evita pagar dos
    veces si el panel pide el mismo veredicto en paralelo."""

    def __init__(
        self,
        database: db.Database,
        *,
        flush_channels: Callable[[], Awaitable[None]] | None = None,
        wait_s: float = 8.0,
        poll_s: float = 0.5,
    ) -> None:
        self._db = database
        self._flush_channels = flush_channels
        self._wait_s = wait_s
        self._poll_s = poll_s
        self._locks: dict[str, asyncio.Lock] = {}

    def load_ficha(self, video_id: str) -> FichaOut | None:
        with self._db.connect() as conn:
            return db.load_ficha(conn, video_id)

    async def decide(
        self, ficha: FichaOut, judge: Judge, policy: Policy, settings: LiveSettings
    ) -> LiveVerdict:
        """POST: regla, caché o llamada al juez."""
        lock = self._locks.setdefault(ficha.video_id, asyncio.Lock())
        async with lock:
            found = self._without_call(ficha, judge, policy, settings, allow_partial=False)
            if found is not None:
                return found
            ficha = await self._wait_for_levels(ficha, settings.config)
            partial = bool(missing_levels(ficha, settings.config))
            if partial:
                found = self._without_call(ficha, judge, policy, settings, allow_partial=True)
                if found is not None:
                    return found
            return await self._call(ficha, judge, policy, settings, partial)

    def latest(
        self, ficha: FichaOut, judge: Judge, policy: Policy, settings: LiveSettings
    ) -> LiveVerdict | None:
        """GET: regla o último veredicto en caché (completo o parcial); nunca llama al juez."""
        return self._without_call(ficha, judge, policy, settings, allow_partial=True)

    # --- internos -------------------------------------------------------------------------

    def _without_call(
        self,
        ficha: FichaOut,
        judge: Judge,
        policy: Policy,
        settings: LiveSettings,
        *,
        allow_partial: bool,
    ) -> LiveVerdict | None:
        decision = apply_rules(ficha, policy.content())
        if decision is not None:
            return self._finish(
                ficha,
                settings,
                policy,
                label=decision.label,
                confidence=1.0,
                probs={label: float(label == decision.label) for label in Label},
                source="rule",
                rule=decision.rule,
                reason=decision.reason,
            )
        configs = [settings.config]
        if allow_partial:
            configs.append(settings.config + PARTIAL_SUFFIX)
        with self._db.connect() as conn:
            found = db.find_latest_verdict(
                conn,
                video_id=ficha.video_id,
                judge=judge.provider,
                model=judge.model,
                configs=configs,
                policy_version=policy.policy_version,
            )
        if found is None:
            return None
        config, verdict = found
        return self._from_verdict(
            ficha, settings, policy, verdict, partial=config != settings.config, cached=True
        )

    async def _wait_for_levels(self, ficha: FichaOut, config: str) -> FichaOut:
        deadline = time.monotonic() + self._wait_s
        flushed = False
        while missing_levels(ficha, config) and time.monotonic() < deadline:
            if not flushed and InfoLevel.L2 in missing_levels(ficha, config):
                flushed = True
                await self._flush_channels_soon(deadline)
            await asyncio.sleep(self._poll_s)
            ficha = self.load_ficha(ficha.video_id) or ficha
        return ficha

    async def _flush_channels_soon(self, deadline: float) -> None:
        """L2 se resuelve por lotes cada N s: no esperar al siguiente lote."""
        if self._flush_channels is None:
            return
        await asyncio.sleep(self._poll_s)  # deja que la tarea de `POST /fichas` encole el canal
        timeout = max(0.0, deadline - time.monotonic())
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(asyncio.shield(self._flush_channels()), timeout)

    async def _call(
        self, ficha: FichaOut, judge: Judge, policy: Policy, settings: LiveSettings, partial: bool
    ) -> LiveVerdict:
        view = ablation.judge_view(build_ficha_view(ficha, config_levels(settings.config)), judge)
        verdict = await ablation.call_with_retries(
            judge, view, policy, max_retries=LIVE_MAX_RETRIES
        )
        config = settings.config + (PARTIAL_SUFFIX if partial else "")
        ablation.store_cached(self._db, ficha.video_id, judge, config, policy, verdict)
        return self._from_verdict(ficha, settings, policy, verdict, partial=partial, cached=False)

    def _from_verdict(
        self,
        ficha: FichaOut,
        settings: LiveSettings,
        policy: Policy,
        verdict: Verdict,
        *,
        partial: bool,
        cached: bool,
    ) -> LiveVerdict:
        return self._finish(
            ficha,
            settings,
            policy,
            label=verdict.label,
            confidence=verdict.confidence,
            probs={label: float(verdict.probs.get(label, 0.0)) for label in Label},
            source="model",
            partial=partial,
            cached=cached,
            cost_usd=0.0 if cached else verdict.cost_usd,
            latency_ms=verdict.latency_ms,
        )

    def _finish(
        self,
        ficha: FichaOut,
        settings: LiveSettings,
        policy: Policy,
        *,
        label: Label,
        confidence: float,
        probs: dict[Label, float],
        source: VerdictSource,
        rule: RuleId | None = None,
        reason: str | None = None,
        partial: bool = False,
        cached: bool = False,
        cost_usd: float = 0.0,
        latency_ms: int = 0,
    ) -> LiveVerdict:
        """Aplica `reveal` y anota la exposición si el veredicto sale visible."""
        with self._db.connect() as conn:
            labeled = db.get_label(conn, ficha.video_id) is not None
            revealed = settings.reveal == "always" or labeled
            if revealed:
                db.record_verdict_exposure(conn, ficha.video_id)
        base = LiveVerdict(
            video_id=ficha.video_id,
            revealed=revealed,
            reveal=settings.reveal,
            judge=settings.judge,
            config=settings.config,
            partial=partial,
            cached=cached,
            cost_usd=cost_usd,
            latency_ms=latency_ms,
            policy_version=policy.policy_version,
        )
        if not revealed:
            return base
        return base.model_copy(
            update={
                "label": label,
                "confidence": confidence,
                "probs": probs,
                "source": source,
                "rule": rule,
                "reason": reason,
            }
        )

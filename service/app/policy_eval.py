"""Evaluación de una política candidata (sin guardar) sobre las etiquetas del split `dev`.

Reutiliza el runner y las métricas de la ablación (`eval/`) y su caché de veredictos: el
candidato lleva el `policy_version` que tendrá al guardarse, así que repetir la evaluación
del mismo texto (o guardarlo y evaluarlo después) no repite llamadas pagadas.

Nunca se usa el split `test`: queda reservado para la ablación final (PLAN §10.2).
"""

import math
from collections.abc import Iterable, Sequence

from pydantic import BaseModel, Field

from app import db
from app.authoring.examples import compact_summary
from app.authoring.models import ErrorExample
from app.judges.base import Judge
from app.models import Label, Split
from app.policy import Policy
from app.pricing import Pricing
from eval import ablation
from eval.metrics import Record, summarize

EVAL_SPLIT: Split = "dev"
MIN_DEV_LABELS = 10
DEFAULT_CONFIG = "D"
WATCH_URL = "https://www.youtube.com/watch?v={video_id}"


class EvalEstimate(BaseModel):
    split: Split = EVAL_SPLIT
    policy_version: str
    judge: str
    config: str
    n_dev: int
    min_labels: int = MIN_DEV_LABELS
    enough_labels: bool
    calls: int = 0  # llamadas nuevas (no cacheadas)
    cached: int = 0
    est_tokens: int = 0
    est_cost_usd: float = 0.0


class Misclassified(BaseModel):
    video_id: str
    title: str
    channel: str | None = None
    url: str
    truth: Label
    predicted: Label
    confidence: float


class EvalOutcome(EvalEstimate):
    n: int = 0
    accuracy: float | None = None
    macro_f1: float | None = None
    false_libre: int = 0
    false_libre_rate: float | None = None
    failures: int = 0
    new_calls: int = 0
    cost_usd: float = 0.0
    errors: list[Misclassified] = Field(default_factory=list)


class ErrorRef(BaseModel):
    """Error que el cliente pide usar para mejorar la política."""

    video_id: str
    predicted: Label
    confidence: float = 0.0


def _plan(
    database: db.Database, judge: Judge, config: str
) -> tuple[list[ablation.LabeledVideo], list[ablation.Job]]:
    videos = ablation.load_dataset(database, EVAL_SPLIT)
    jobs = ablation.build_jobs(database, videos, [judge], [config])
    return videos, jobs


def estimate_candidate(
    database: db.Database, judge: Judge, policy: Policy, config: str, pricing: Pricing
) -> EvalEstimate:
    videos, jobs = _plan(database, judge, config)
    rows = ablation.estimate(database, jobs, policy, pricing)
    return EvalEstimate(
        policy_version=policy.policy_version,
        judge=judge.name,
        config=config,
        n_dev=len(videos),
        enough_labels=len(videos) >= MIN_DEV_LABELS,
        calls=sum(r.calls for r in rows),
        cached=sum(r.cached for r in rows),
        est_tokens=sum(r.est_tokens for r in rows),
        est_cost_usd=sum(r.est_cost_usd for r in rows),
    )


async def evaluate_candidate(
    database: db.Database,
    judge: Judge,
    policy: Policy,
    config: str,
    pricing: Pricing,
    *,
    concurrency: int = 4,
    sleep: ablation.Sleep | None = None,
) -> EvalOutcome:
    estimate = estimate_candidate(database, judge, policy, config, pricing)
    if not estimate.enough_labels:
        return EvalOutcome(**estimate.model_dump())
    _, jobs = _plan(database, judge, config)
    extra = {"sleep": sleep} if sleep is not None else {}
    result = await ablation.run_jobs(database, jobs, policy, concurrency=concurrency, **extra)
    channels = {job.video_id: job.video.ficha.metadata.channel_name for job in jobs}
    return EvalOutcome(
        **estimate.model_dump(),
        **_metrics(result.records),
        failures=len(result.failures),
        new_calls=result.calls,
        cost_usd=sum(r.cost_usd for r in result.records if not r.cached),
        errors=_misclassified(result.records, channels),
    )


def _finite(value: float) -> float | None:
    return None if math.isnan(value) else value


def _metrics(records: Sequence[Record]) -> dict[str, float | int | None]:
    if not records:
        return {"n": 0}
    summary = summarize(records)
    false_libre = sum(r.pred == Label.LIBRE and r.truth != Label.LIBRE for r in records)
    return {
        "n": summary.n,
        "accuracy": _finite(summary.accuracy),
        "macro_f1": _finite(summary.macro_f1),
        "false_libre": false_libre,
        "false_libre_rate": _finite(summary.false_libre_rate),
    }


def _misclassified(
    records: Iterable[Record], channels: dict[str, str | None]
) -> list[Misclassified]:
    wrong = [r for r in records if not r.correct]
    # Primero los falsos LIBRE (el error grave), luego por confianza descendente.
    wrong.sort(key=lambda r: (r.pred != Label.LIBRE, -r.confidence))
    return [
        Misclassified(
            video_id=r.video_id,
            title=r.title,
            channel=channels.get(r.video_id),
            url=WATCH_URL.format(video_id=r.video_id),
            truth=r.truth,
            predicted=r.pred,
            confidence=r.confidence,
        )
        for r in wrong
    ]


def dev_error_examples(
    database: db.Database, refs: Sequence[ErrorRef], config: str
) -> list[ErrorExample]:
    """Resúmenes de los errores pedidos. Solo vídeos del split dev (el resto se ignora) y con
    la etiqueta real de la base de datos, no la que envíe el cliente."""
    by_id = {v.ficha.video_id: v for v in ablation.load_dataset(database, EVAL_SPLIT)}
    examples = []
    for ref in refs:
        video = by_id.get(ref.video_id)
        if video is None or video.truth == ref.predicted:
            continue
        view = ablation.build_view(database, video, config)
        examples.append(
            ErrorExample(
                video_id=ref.video_id,
                truth=video.truth,
                predicted=ref.predicted,
                confidence=ref.confidence,
                summary=compact_summary(view),
            )
        )
    return examples

"""Registro de jueces: clave de la ablación → adaptador."""

from collections.abc import Callable

import httpx
from pydantic import BaseModel

from app.config import Settings
from app.judges.base import HttpJudge, Judge
from app.judges.liquid import LiquidJudge
from app.judges.openai_decisions import OpenAIDecisionsJudge
from app.judges.sonnet import SonnetJudge
from app.pricing import Pricing

JudgeFactory = Callable[..., HttpJudge]

# clave → (fábrica, nombre del atributo de Settings con la API key)
JUDGES: dict[str, tuple[JudgeFactory, str]] = {
    "liquid/d1.2-ultra": (lambda *a, **k: LiquidJudge("d1.2-ultra", *a, **k), "liquid_api_key"),
    "liquid/d1.2": (lambda *a, **k: LiquidJudge("d1.2", *a, **k), "liquid_api_key"),
    "openai/decisions": (OpenAIDecisionsJudge, "openai_api_key"),
    "anthropic/sonnet": (SonnetJudge, "anthropic_api_key"),
}


class MissingApiKeyError(RuntimeError):
    pass


class JudgeInfo(BaseModel):
    """Juez disponible para la UI. Solo dice si hay clave, nunca su valor."""

    key: str
    key_env: str
    key_configured: bool
    input_per_mtok: float | None = None
    output_per_mtok: float | None = None


def judge_catalog(settings: Settings, pricing: Pricing) -> list[JudgeInfo]:
    infos = []
    for key, (_, key_attr) in JUDGES.items():
        price = pricing.models.get(key)
        infos.append(
            JudgeInfo(
                key=key,
                key_env=key_attr.upper(),
                key_configured=bool(getattr(settings, key_attr)),
                input_per_mtok=price.input_per_mtok if price else None,
                output_per_mtok=price.output_per_mtok if price else None,
            )
        )
    return infos


def default_judge(infos: list[JudgeInfo]) -> str | None:
    """El juez más barato (precio de entrada) con clave configurada."""
    usable = [i for i in infos if i.key_configured and i.input_per_mtok is not None]
    if not usable:
        return None
    return min(usable, key=lambda i: (i.input_per_mtok, i.output_per_mtok or 0.0)).key


def create_judge(
    key: str,
    client: httpx.AsyncClient,
    settings: Settings,
    pricing: Pricing,
    *,
    require_key: bool = True,
) -> Judge:
    """`require_key=False` permite construir el juez sin clave (p. ej. para `--dry-run`)."""
    try:
        factory, key_attr = JUDGES[key]
    except KeyError:
        raise KeyError(f"Unknown judge {key!r}; available: {', '.join(JUDGES)}") from None
    api_key = getattr(settings, key_attr) or ""
    if require_key and not api_key:
        raise MissingApiKeyError(f"{key_attr.upper()} is not set (needed for {key})")
    return factory(client, api_key, pricing, settings.data_dir, timeout_s=settings.judge_timeout_s)

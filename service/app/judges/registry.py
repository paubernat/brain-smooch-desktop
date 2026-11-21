"""Registro de jueces: clave de la ablación → adaptador."""

from collections.abc import Callable

import httpx

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

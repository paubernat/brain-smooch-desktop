"""Dependencias de los routers: precios, fábrica de jueces y cliente del editor agéntico.

Se inyectan con `Depends` para que los tests puedan sustituirlas (`dependency_overrides`).
"""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException

from app.authoring.client import ClaudeAuthorClient
from app.judges.base import Judge
from app.judges.registry import MissingApiKeyError, create_judge
from app.pricing import Pricing, load_pricing
from app.state import AppState, get_ctx

JudgeFactory = Callable[[str, bool], Judge]  # (clave, require_key) → juez

Ctx = Annotated[AppState, Depends(get_ctx)]


def get_pricing(ctx: Ctx) -> Pricing:
    return load_pricing(ctx.settings.pricing_path)  # se relee: pricing.yaml es editable


def get_judge_factory(ctx: Ctx, pricing: Annotated[Pricing, Depends(get_pricing)]) -> JudgeFactory:
    def factory(key: str, require_key: bool) -> Judge:
        try:
            return create_judge(key, ctx.client, ctx.settings, pricing, require_key=require_key)
        except KeyError as exc:
            raise HTTPException(status_code=400, detail=str(exc.args[0])) from exc
        except MissingApiKeyError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc

    return factory


def get_author_client(
    ctx: Ctx, pricing: Annotated[Pricing, Depends(get_pricing)]
) -> ClaudeAuthorClient:
    settings = ctx.settings
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=503, detail="ANTHROPIC_API_KEY is not set (needed for the policy author)"
        )
    return ClaudeAuthorClient(
        ctx.client,
        settings.anthropic_api_key,
        settings.policy_author_model,
        pricing,
        timeout_s=settings.policy_author_timeout_s,
    )


PricingDep = Annotated[Pricing, Depends(get_pricing)]
JudgeFactoryDep = Annotated[JudgeFactory, Depends(get_judge_factory)]
AuthorDep = Annotated[ClaudeAuthorClient, Depends(get_author_client)]

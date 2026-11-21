"""`GET /judges`: jueces disponibles (clave configurada sí/no, precio) y configuraciones."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.judges.registry import JudgeInfo, default_judge, judge_catalog
from app.policy_eval import DEFAULT_CONFIG
from app.routes.deps import Ctx, PricingDep
from eval.configs import CONFIG_LEVELS, describe

router = APIRouter()


class ConfigInfo(BaseModel):
    id: str
    levels: str  # p. ej. "L1+L2+L3"


class JudgesOut(BaseModel):
    judges: list[JudgeInfo]
    default_judge: str | None
    configs: list[ConfigInfo]
    default_config: str


@router.get("/judges", response_model=JudgesOut)
async def get_judges(ctx: Ctx, pricing: PricingDep) -> JudgesOut:
    infos = judge_catalog(ctx.settings, pricing)
    return JudgesOut(
        judges=infos,
        default_judge=default_judge(infos),
        configs=[ConfigInfo(id=c, levels=describe(c)) for c in CONFIG_LEVELS],
        default_config=DEFAULT_CONFIG,
    )

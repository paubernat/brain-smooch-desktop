"""Recalibración: etiquetas pendientes de incorporar a la política y propuesta de Claude.

- `GET /policy/feedback`: cuántas etiquetas dev están pendientes (y cuántas test, solo info).
- `POST /policy/refresh`: Claude propone una política revisada con las pendientes; no guarda.
  Al guardar con `PUT /policy` y `incorporate` = `feedback` de la respuesta, se marcan.
"""

from fastapi import APIRouter, HTTPException

from app.authoring.author import refresh_with_feedback
from app.authoring.models import RefreshResult
from app.judges.base import JudgeError
from app.policy_feedback import FeedbackOut, feedback_summary, pending_dev_examples
from app.routes.deps import AuthorDep, Ctx
from app.routes.policy_schemas import RefreshIn
from eval.configs import config_levels

router = APIRouter(prefix="/policy")


@router.get("/feedback", response_model=FeedbackOut)
async def get_feedback(ctx: Ctx, items: bool = True) -> FeedbackOut:
    return feedback_summary(ctx.database, include_items=items)


@router.post("/refresh", response_model=RefreshResult)
async def post_refresh(body: RefreshIn, ctx: Ctx, author: AuthorDep) -> RefreshResult:
    try:
        config_levels(body.config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    examples = pending_dev_examples(ctx.database, body.config)
    if not examples:
        raise HTTPException(status_code=422, detail="no pending dev labels to incorporate")
    policy = ctx.policies.load()
    try:
        return await refresh_with_feedback(
            author, policy.content(), examples, policy.version, instruction=body.instruction
        )
    except JudgeError as exc:
        raise HTTPException(status_code=502, detail=f"policy author failed: {exc}") from exc

"""Endpoints del editor de perfil: leer/guardar la política, historial, borrador con Claude,
evaluación en el split dev, mejora con los errores y edición con una instrucción.

La recalibración con las etiquetas pendientes está en `routes/feedback.py`."""

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.authoring.author import (
    draft_from_preferences,
    edit_with_instruction,
    refine_with_errors,
)
from app.authoring.models import DraftResult, EditResult, RefineResult
from app.judges.base import JudgeError
from app.judges.registry import default_judge, judge_catalog
from app.policy_eval import EvalOutcome, dev_error_examples, estimate_candidate, evaluate_candidate
from app.policy_feedback import mark_incorporated
from app.policy_store import HistoryEntry, PolicyConflictError, parse_policy_yaml
from app.routes.deps import AuthorDep, Ctx, JudgeFactoryDep, PricingDep
from app.routes.policy_schemas import (
    DraftIn,
    EditIn,
    EvaluateIn,
    PolicyOut,
    PolicyUpdate,
    RefineIn,
)
from eval.configs import config_levels

router = APIRouter(prefix="/policy")


def _policy_out(ctx: Ctx) -> PolicyOut:
    policy = ctx.policies.load()
    return PolicyOut(
        version=policy.version,
        policy_version=policy.policy_version,
        content=policy.content(),
        yaml=ctx.policies.raw_text(),
    )


def _check_config(config: str) -> None:
    try:
        config_levels(config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=PolicyOut)
async def get_policy(ctx: Ctx) -> PolicyOut:
    return _policy_out(ctx)


@router.put("", response_model=PolicyOut)
async def put_policy(body: PolicyUpdate, ctx: Ctx) -> PolicyOut:
    try:
        content = body.content if body.content is not None else parse_policy_yaml(body.yaml or "")
        saved = ctx.policies.save(content, expected_version=body.expected_version)
    except PolicyConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except (yaml.YAMLError, ValidationError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"invalid policy: {exc}") from exc
    incorporated = mark_incorporated(ctx.database, body.incorporate, saved.version)
    return _policy_out(ctx).model_copy(update={"incorporated": incorporated})


@router.get("/history", response_model=list[HistoryEntry])
async def get_history(ctx: Ctx) -> list[HistoryEntry]:
    return ctx.policies.history()


@router.post("/draft", response_model=DraftResult)
async def post_draft(body: DraftIn, ctx: Ctx, author: AuthorDep) -> DraftResult:
    if body.preferences.is_empty():
        raise HTTPException(status_code=422, detail="preferences are empty")
    try:
        return await draft_from_preferences(author, body.preferences, ctx.policies.load().content())
    except JudgeError as exc:
        raise HTTPException(status_code=502, detail=f"policy author failed: {exc}") from exc


@router.post("/evaluate", response_model=EvalOutcome)
async def post_evaluate(
    body: EvaluateIn, ctx: Ctx, pricing: PricingDep, make_judge: JudgeFactoryDep
) -> EvalOutcome:
    _check_config(body.config)
    key = body.judge or default_judge(judge_catalog(ctx.settings, pricing))
    if key is None:
        raise HTTPException(status_code=503, detail="no judge has an API key configured")
    judge = make_judge(key, not body.dry_run)
    candidate = ctx.policies.candidate(body.content)
    if body.dry_run:
        estimate = estimate_candidate(ctx.database, judge, candidate, body.config, pricing)
        return EvalOutcome(**estimate.model_dump())
    return await evaluate_candidate(ctx.database, judge, candidate, body.config, pricing)


@router.post("/refine", response_model=RefineResult)
async def post_refine(body: RefineIn, ctx: Ctx, author: AuthorDep) -> RefineResult:
    _check_config(body.config)
    examples = dev_error_examples(ctx.database, body.errors, body.config)
    if not examples:
        raise HTTPException(status_code=422, detail="no misclassified dev videos among `errors`")
    try:
        return await refine_with_errors(
            author, body.draft, examples, snapshot=body.snapshot, prefs=body.preferences
        )
    except JudgeError as exc:
        raise HTTPException(status_code=502, detail=f"policy author failed: {exc}") from exc


@router.post("/edit", response_model=EditResult)
async def post_edit(body: EditIn, author: AuthorDep) -> EditResult:
    if not body.instruction.strip():
        raise HTTPException(status_code=422, detail="instruction is empty")
    try:
        return await edit_with_instruction(author, body.policy, body.instruction)
    except JudgeError as exc:
        raise HTTPException(status_code=502, detail=f"policy author failed: {exc}") from exc

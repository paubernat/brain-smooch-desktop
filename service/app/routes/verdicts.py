"""Juez en directo: `POST/GET /verdicts/{video_id}` y sus ajustes `GET/PUT /settings/live`."""

from fastapi import APIRouter, HTTPException, Request

from app.judges.base import JudgeError
from app.live_judge import LiveSettings, LiveVerdict, load_live_settings, save_live_settings
from app.lock.classify import live_relaxations
from app.models import FichaOut
from app.routes.deps import Ctx, JudgeFactoryDep

router = APIRouter()


def _ficha(ctx: Ctx, video_id: str) -> FichaOut:
    ficha = ctx.live.load_ficha(video_id)
    if ficha is None:
        raise HTTPException(status_code=404, detail="ficha not found")
    return ficha


@router.post("/verdicts/{video_id}", response_model=LiveVerdict)
async def post_verdict(video_id: str, ctx: Ctx, make_judge: JudgeFactoryDep) -> LiveVerdict:
    ficha = _ficha(ctx, video_id)
    settings = load_live_settings(ctx.database)
    judge = make_judge(settings.judge, True)
    try:
        return await ctx.live.decide(ficha, judge, ctx.policies.load(), settings)
    except JudgeError as exc:
        raise HTTPException(status_code=502, detail=f"judge failed: {exc}") from exc


@router.get("/verdicts/{video_id}", response_model=LiveVerdict)
async def get_verdict(video_id: str, ctx: Ctx, make_judge: JudgeFactoryDep) -> LiveVerdict:
    ficha = _ficha(ctx, video_id)
    settings = load_live_settings(ctx.database)
    judge = make_judge(settings.judge, False)  # solo lee la caché: no hace falta la clave
    found = ctx.live.latest(ficha, judge, ctx.policies.load(), settings)
    if found is None:
        raise HTTPException(status_code=404, detail="no verdict yet")
    return found


@router.get("/settings/live", response_model=LiveSettings)
async def get_live_settings(ctx: Ctx) -> LiveSettings:
    return load_live_settings(ctx.database)


@router.put("/settings/live", response_model=LiveSettings)
async def put_live_settings(body: LiveSettings, request: Request, ctx: Ctx) -> LiveSettings:
    relax = live_relaxations(load_live_settings(ctx.database), body)
    ctx.lock.authorize(request, relax, kind="live", payload=body.model_dump())
    return save_live_settings(ctx.database, body)

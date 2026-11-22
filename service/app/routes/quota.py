"""Cupo diario de LIMITADO: `GET /quota/today`, `POST /quota/heartbeat` y sus ajustes
`GET/PUT /settings/quota` (subir el cupo es relajar)."""

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel, Field

from app.lock.classify import quota_relaxations
from app.quota.rules import QuotaSettings, VideoProgress
from app.quota.tracker import QuotaToday
from app.routes.deps import Ctx

router = APIRouter()

VIDEO_ID_PATTERN = r"^[A-Za-z0-9_-]{11}$"


class HeartbeatIn(BaseModel):
    video_id: str = Field(pattern=VIDEO_ID_PATTERN)
    seconds: float = Field(ge=0, le=600)  # el servicio cuenta como mucho 30 s por latido
    duration_s: float | None = Field(default=None, ge=0)
    position_s: float | None = Field(default=None, ge=0)
    # Pestaña que envía (id aleatorio por página) y número de latido creciente: el servicio
    # descarta repetidos y no cuenta más tiempo que el transcurrido desde el anterior.
    tab_id: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{8,64}$")
    seq: int | None = Field(default=None, ge=0)


@router.get("/quota/today", response_model=QuotaToday)
async def get_today(
    ctx: Ctx,
    video_id: str | None = Query(default=None, pattern=VIDEO_ID_PATTERN),
    duration_s: float | None = Query(default=None, ge=0),
    position_s: float | None = Query(default=None, ge=0),
) -> QuotaToday:
    video = VideoProgress(video_id, duration_s, position_s) if video_id else None
    return ctx.quota.today(video)


@router.post("/quota/heartbeat", response_model=QuotaToday)
async def post_heartbeat(body: HeartbeatIn, ctx: Ctx) -> QuotaToday:
    video = VideoProgress(body.video_id, body.duration_s, body.position_s)
    return ctx.quota.heartbeat(video, body.seconds, tab_id=body.tab_id, seq=body.seq)


@router.get("/settings/quota", response_model=QuotaSettings)
async def get_quota_settings(ctx: Ctx) -> QuotaSettings:
    return ctx.quota.settings()


@router.put("/settings/quota", response_model=QuotaSettings)
async def put_quota_settings(body: QuotaSettings, request: Request, ctx: Ctx) -> QuotaSettings:
    relax = quota_relaxations(ctx.quota.settings(), body)
    ctx.lock.authorize(request, relax, kind="quota", payload=body.model_dump())
    return ctx.quota.save_settings(body)

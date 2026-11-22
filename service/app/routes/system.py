"""Windows enforcement layers (`/system/*`, PLAN-FASE2 §4, §6). See `app/enforce/`.

- `GET /system/layers`: status of E1-E9 (the dashboard's "Layers" panel).
- `GET /system/events`: tamper events, browsers seen/closed, layers applied/removed.
- `POST /system/apply`: hardening, no password: re-arm the integrity check and apply now.
- `POST /system/uninstall`: relaxing: admin session + CSRF (if a password exists). Removes the
  managed layers (E6, E5, E4) and suspends the repair; `uninstall.ps1` then removes the
  watchdog and the service.
"""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Request

from app.enforce.events import EnforceEvent, EventKind
from app.enforce.manager import SystemStatus, UninstallResult
from app.routes.deps import Ctx

router = APIRouter(prefix="/system")

NOT_INSTALLED = (
    "layers are applied only by the installed service (BS_PRODUCTION=1, run install.ps1)"
)


@router.get("/layers", response_model=SystemStatus)
async def get_layers(ctx: Ctx) -> SystemStatus:
    return ctx.enforce.status()


@router.get("/events", response_model=list[EnforceEvent])
async def get_events(
    ctx: Ctx,
    limit: Annotated[int, Query(ge=1, le=500)] = 50,
    kind: Annotated[list[EventKind] | None, Query()] = None,
) -> list[EnforceEvent]:
    return ctx.enforce.events.recent(limit, kind)


@router.post("/apply", response_model=SystemStatus)
async def post_apply(ctx: Ctx) -> SystemStatus:
    if not ctx.enforce.integrity.enabled:
        raise HTTPException(status_code=409, detail=NOT_INSTALLED)
    ctx.enforce.integrity.rearm()
    return ctx.enforce.status()


@router.post("/uninstall", response_model=UninstallResult)
async def post_uninstall(request: Request, ctx: Ctx) -> UninstallResult:
    if ctx.lock.vault.is_set():
        ctx.lock.admin_session(request)
    if not ctx.enforce.integrity.enabled:
        raise HTTPException(status_code=409, detail=NOT_INSTALLED)
    return UninstallResult(removed=ctx.enforce.integrity.suspend_and_remove())

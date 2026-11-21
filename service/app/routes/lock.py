"""Candado (`/lock/*`): contraseña del custodio, sesión de administrador y solicitudes de
relajación con espera. Ver `app/lock/` y docs/api-contract.md."""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.lock.apply import apply_due
from app.lock.classify import lock_relaxations
from app.lock.password import MAX_RELAX_DELAY_HOURS, PasswordError, check_new_password
from app.lock.requests import RelaxRequest
from app.lock.sessions import (
    COOKIE_NAME,
    Session,
    clear_session_cookie,
    set_session_cookie,
)
from app.routes.deps import Ctx

router = APIRouter(prefix="/lock")


class SessionOut(BaseModel):
    expires_at: float  # segundos de época
    csrf: str


class LockStatus(BaseModel):
    password_set: bool
    custodian: str
    created_at: str | None
    relax_delay_hours: int
    session: SessionOut | None
    retry_after_s: float


class SetupIn(BaseModel):
    custodian: str = Field(min_length=1, max_length=100)
    password: str
    password_confirm: str
    relax_delay_hours: int = Field(default=0, ge=0, le=MAX_RELAX_DELAY_HOURS)


class LoginIn(BaseModel):
    password: str = Field(max_length=1024)


class PasswordChangeIn(BaseModel):
    password: str
    password_confirm: str


class LockSettingsIn(BaseModel):
    relax_delay_hours: int = Field(ge=0, le=MAX_RELAX_DELAY_HOURS)


def _status(ctx: Ctx, session: Session | None) -> LockStatus:
    settings = ctx.lock.vault.settings()
    return LockStatus(
        password_set=settings.password_hash is not None,
        custodian=settings.custodian,
        created_at=settings.created_at,
        relax_delay_hours=settings.relax_delay_hours,
        session=SessionOut(expires_at=session.expires_at, csrf=session.csrf) if session else None,
        retry_after_s=round(ctx.login_limiter.retry_after(), 1),
    )


def _open_session(ctx: Ctx, response: Response) -> Session:
    session = ctx.lock.sessions.create()
    set_session_cookie(response, session, ctx.lock.sessions.ttl_s)
    return session


@router.get("/status", response_model=LockStatus)
async def get_status(request: Request, ctx: Ctx) -> LockStatus:
    return _status(ctx, ctx.lock.sessions.from_request(request))


@router.post("/setup", response_model=LockStatus)
async def post_setup(body: SetupIn, response: Response, ctx: Ctx) -> LockStatus:
    """Crea la contraseña (último paso del onboarding). Solo si aún no existe."""
    vault = ctx.lock.vault
    if vault.is_set():
        raise HTTPException(status_code=409, detail="a password already exists")
    try:
        check_new_password(body.password, body.password_confirm)
    except PasswordError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    vault.set_password(body.password, custodian=body.custodian)
    vault.save(vault.settings().model_copy(update={"relax_delay_hours": body.relax_delay_hours}))
    return _status(ctx, _open_session(ctx, response))


@router.post("/login", response_model=LockStatus)
async def post_login(body: LoginIn, response: Response, ctx: Ctx) -> LockStatus:
    limiter = ctx.login_limiter
    wait = limiter.retry_after()
    if wait > 0:
        raise HTTPException(
            status_code=429,
            detail=f"too many attempts; retry in {wait:.0f} s",
            headers={"Retry-After": str(int(wait) + 1)},
        )
    if not ctx.lock.vault.is_set():
        raise HTTPException(status_code=409, detail="no password has been set")
    if not ctx.lock.vault.verify(body.password):
        limiter.failure()
        raise HTTPException(status_code=401, detail="wrong password")
    limiter.success()
    return _status(ctx, _open_session(ctx, response))


@router.post("/logout", response_model=LockStatus)
async def post_logout(request: Request, response: Response, ctx: Ctx) -> LockStatus:
    ctx.lock.sessions.revoke(request.cookies.get(COOKIE_NAME))
    clear_session_cookie(response)
    return _status(ctx, None)


@router.post("/password", response_model=LockStatus)
async def post_password(
    body: PasswordChangeIn, request: Request, response: Response, ctx: Ctx
) -> LockStatus:
    """Cambiar la contraseña: siempre con sesión de administrador. Cierra las demás sesiones."""
    ctx.lock.admin_session(request)
    try:
        check_new_password(body.password, body.password_confirm)
    except PasswordError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    ctx.lock.vault.set_password(body.password)
    ctx.lock.sessions.revoke_all()
    return _status(ctx, _open_session(ctx, response))


@router.put("/settings", response_model=LockStatus)
async def put_settings(body: LockSettingsIn, request: Request, ctx: Ctx) -> LockStatus:
    vault = ctx.lock.vault
    current = vault.settings()
    new = current.model_copy(update=body.model_dump())
    ctx.lock.authorize(
        request, lock_relaxations(current, new), kind="lock", payload=body.model_dump()
    )
    vault.save(new)
    return _status(ctx, ctx.lock.sessions.from_request(request))


@router.get("/requests", response_model=list[RelaxRequest])
async def get_requests(ctx: Ctx) -> list[RelaxRequest]:
    apply_due(ctx)
    return ctx.lock.requests.recent()


@router.post("/requests/{request_id}/cancel", response_model=list[RelaxRequest])
async def cancel_request(request_id: int, ctx: Ctx) -> list[RelaxRequest]:
    """Cancelar endurece: no pide contraseña."""
    if not ctx.lock.requests.cancel(request_id):
        raise HTTPException(status_code=404, detail="no pending request with that id")
    return ctx.lock.requests.recent()

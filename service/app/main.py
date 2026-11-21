"""API local (PLAN §7.1, docs/api-contract.md). Escucha solo en 127.0.0.1.

También sirve la web local (onboarding y panel, PLAN-FASE2 §3) en `/`: el bundle que genera
`extension/build.mjs` en `app/web/static/`.
"""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from app import db
from app.config import Settings, get_settings
from app.enrich.channel import ChannelEnricher
from app.enrich.pipeline import EnrichmentPipeline
from app.live_judge import LiveJudge
from app.lock.apply import apply_due
from app.lock.guard import LockGuard, RelaxDeferred
from app.lock.password import PasswordVault
from app.lock.rate_limit import LoginLimiter
from app.lock.requests import RelaxRequestStore
from app.lock.sessions import SessionManager
from app.models import FichaIn, FichaOut, LabelIn, LabelOut, Stats
from app.policy_migration import migrate_verdict_keys
from app.policy_store import PolicyStore
from app.quota.tracker import QuotaTracker
from app.routes import enforcement as enforcement_routes
from app.routes import feedback as feedback_routes
from app.routes import judges as judges_routes
from app.routes import lock as lock_routes
from app.routes import policy as policy_routes
from app.routes import quota as quota_routes
from app.routes import verdicts as verdict_routes
from app.state import AppState, get_ctx

EXTENSION_ORIGIN_REGEX = r"^moz-extension://.*$"
USER_AGENT = "brain-smooch-service/0.1"
WEB_DIR = Path(__file__).resolve().parent / "web" / "static"
RELAX_APPLY_INTERVAL_S = 60.0

log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database = db.Database(settings.db_path)
        database.init()
        migrate_verdict_keys(database, settings.policy_path, settings.policy_history_dir)
        settings.frames_dir.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient(
            timeout=settings.http_timeout_s,
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        ) as client:
            channels = ChannelEnricher(
                database,
                client,
                settings.youtube_api_key,
                flush_seconds=settings.channel_flush_seconds,
                cache_days=settings.channel_cache_days,
            )
            pipeline = EnrichmentPipeline(database, client, channels, settings.data_dir)
            policies = PolicyStore(settings.policy_path, settings.policy_history_dir)
            live = LiveJudge(
                database,
                flush_channels=channels.flush,
                wait_s=settings.live_wait_s,
                poll_s=settings.live_poll_s,
            )
            guard = LockGuard(
                PasswordVault(database), SessionManager(), RelaxRequestStore(database)
            )
            ctx = AppState(
                settings,
                database,
                pipeline,
                channels,
                client,
                policies,
                live,
                quota=QuotaTracker(database),
                lock=guard,
                login_limiter=LoginLimiter(database),
            )
            app.state.ctx = ctx
            tasks = [
                asyncio.create_task(channels.run_forever()),
                asyncio.create_task(_apply_relax_requests_forever(ctx)),
            ]
            tasks += [asyncio.create_task(pipeline.enrich_frames(v)) for v in pipeline.resume()]
            try:
                yield
            finally:
                for task in tasks:
                    task.cancel()
                for task in tasks:
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await task

    app = FastAPI(title="brain-smooch service", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=EXTENSION_ORIGIN_REGEX,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    app.add_exception_handler(RelaxDeferred, _relax_deferred)
    _register_routes(app)
    app.include_router(policy_routes.router)
    app.include_router(feedback_routes.router)
    app.include_router(judges_routes.router)
    app.include_router(verdict_routes.router)
    app.include_router(quota_routes.router)
    app.include_router(enforcement_routes.router)
    app.include_router(lock_routes.router)
    _register_web(app)
    return app


async def _apply_relax_requests_forever(ctx: AppState) -> None:
    while True:
        await asyncio.sleep(RELAX_APPLY_INTERVAL_S)
        try:
            apply_due(ctx)
        except Exception:
            log.exception("applying relax requests failed")


async def _relax_deferred(request: Request, exc: Exception) -> Response:
    """Un cambio que relaja con espera configurada: se guarda como solicitud (`202`)."""
    assert isinstance(exc, RelaxDeferred)
    body = {"deferred": True, "request": exc.request.model_dump(mode="json")}
    return JSONResponse(status_code=202, content=body)


WEB_MISSING = """<!doctype html><meta charset="utf-8"><title>Brain Smooch</title>
<p>The local web is not built yet. Run <code>cd extension && npm run build</code>.</p>"""


def _register_web(app: FastAPI) -> None:
    """La web local: `/` es `index.html`; el resto de ficheros, estáticos. Va al final para
    que las rutas de la API tengan prioridad."""

    @app.get("/", include_in_schema=False)
    async def index() -> Response:
        page = WEB_DIR / "index.html"
        if not page.is_file():
            return HTMLResponse(WEB_MISSING, status_code=503)
        return FileResponse(page, headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=WEB_DIR, check_dir=False), name="web")


def _ctx(request: Request) -> AppState:
    return get_ctx(request)


def _register_routes(app: FastAPI) -> None:
    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/fichas", response_model=FichaOut)
    async def post_ficha(ficha: FichaIn, request: Request, background: BackgroundTasks) -> FichaOut:
        ctx = _ctx(request)
        stored = ctx.pipeline.ingest(ficha)
        background.add_task(ctx.pipeline.enrich, ficha.video_id)
        return stored

    @app.get("/fichas/{video_id}", response_model=FichaOut)
    async def get_ficha(video_id: str, request: Request) -> FichaOut:
        with _ctx(request).database.connect() as conn:
            ficha = db.load_ficha(conn, video_id)
        if ficha is None:
            raise HTTPException(status_code=404, detail="ficha not found")
        return ficha

    @app.post("/labels", response_model=LabelOut)
    async def post_label(body: LabelIn, request: Request) -> LabelOut:
        with _ctx(request).database.connect() as conn:
            if db.get_video_row(conn, body.video_id) is None:
                raise HTTPException(status_code=404, detail="ficha not found")
            return db.upsert_label(conn, body.video_id, body.label, body.reason)

    @app.get("/labels/stats", response_model=Stats)
    async def get_stats(request: Request) -> Stats:
        with _ctx(request).database.connect() as conn:
            return db.label_stats(conn)


app = create_app()

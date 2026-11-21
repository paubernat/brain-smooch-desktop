"""API local (PLAN §7.1, docs/api-contract.md). Escucha solo en 127.0.0.1."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.config import Settings, get_settings
from app.enrich.channel import ChannelEnricher
from app.enrich.pipeline import EnrichmentPipeline
from app.models import FichaIn, FichaOut, LabelIn, LabelOut, Stats
from app.policy_store import PolicyStore
from app.routes import feedback as feedback_routes
from app.routes import judges as judges_routes
from app.routes import policy as policy_routes
from app.state import AppState, get_ctx

EXTENSION_ORIGIN_REGEX = r"^moz-extension://.*$"
USER_AGENT = "brain-smooch-service/0.1"

log = logging.getLogger(__name__)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        database = db.Database(settings.db_path)
        database.init()
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
            app.state.ctx = AppState(settings, database, pipeline, channels, client, policies)
            tasks = [asyncio.create_task(channels.run_forever())]
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
    _register_routes(app)
    app.include_router(policy_routes.router)
    app.include_router(feedback_routes.router)
    app.include_router(judges_routes.router)
    return app


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

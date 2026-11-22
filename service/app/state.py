"""Estado compartido de la app (creado en el `lifespan` de `main.py`) y dependencias."""

from dataclasses import dataclass

import httpx
from fastapi import Request

from app import db
from app.config import Settings
from app.enforce.manager import EnforceManager
from app.enrich.channel import ChannelEnricher
from app.enrich.pipeline import EnrichmentPipeline
from app.live_judge import LiveJudge
from app.lock.guard import LockGuard
from app.lock.rate_limit import LoginLimiter
from app.policy_store import PolicyStore
from app.quota.tracker import QuotaTracker


@dataclass
class AppState:
    settings: Settings
    database: db.Database
    pipeline: EnrichmentPipeline
    channels: ChannelEnricher
    client: httpx.AsyncClient
    policies: PolicyStore
    live: LiveJudge
    quota: QuotaTracker
    lock: LockGuard
    login_limiter: LoginLimiter
    enforce: EnforceManager


def get_ctx(request: Request) -> AppState:
    return request.app.state.ctx

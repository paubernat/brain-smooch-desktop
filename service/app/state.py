"""Estado compartido de la app (creado en el `lifespan` de `main.py`) y dependencias."""

from dataclasses import dataclass

import httpx
from fastapi import Request

from app import db
from app.config import Settings
from app.enrich.channel import ChannelEnricher
from app.enrich.pipeline import EnrichmentPipeline
from app.policy_store import PolicyStore


@dataclass
class AppState:
    settings: Settings
    database: db.Database
    pipeline: EnrichmentPipeline
    channels: ChannelEnricher
    client: httpx.AsyncClient
    policies: PolicyStore


def get_ctx(request: Request) -> AppState:
    return request.app.state.ctx

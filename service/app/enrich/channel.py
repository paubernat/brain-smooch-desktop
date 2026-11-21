"""L2 — Canal (PLAN §7.3).

Cola de `channel_id` pendientes; se vacía cada N segundos o al llegar a 50, con una llamada
a `channels.list` (`part=snippet,topicDetails,brandingSettings`, 1 unidad de cuota).
Caché permanente en SQLite; se refresca si tiene más de 30 días.
"""

import asyncio
import logging
from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app import db
from app.models import ChannelInfo

log = logging.getLogger(__name__)

CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
CHANNEL_PARTS = "snippet,topicDetails,brandingSettings"
MAX_BATCH = 50


def topic_name(topic_url: str) -> str:
    """`https://en.wikipedia.org/wiki/Video_game_culture` → `Video_game_culture`."""
    return topic_url.rstrip("/").rsplit("/", 1)[-1]


def parse_channel_item(item: dict[str, Any], fetched_at: str) -> ChannelInfo:
    snippet = item.get("snippet", {})
    topics = item.get("topicDetails", {}).get("topicCategories", [])
    branding = item.get("brandingSettings", {}).get("channel", {})
    return ChannelInfo(
        channel_id=item["id"],
        title=snippet.get("title"),
        description=snippet.get("description", ""),
        topics=[topic_name(url) for url in topics],
        keywords=branding.get("keywords", ""),
        fetched_at=fetched_at,
    )


async def fetch_channels(
    client: httpx.AsyncClient, api_key: str, channel_ids: list[str]
) -> list[ChannelInfo]:
    """Una llamada a `channels.list` para hasta 50 canales."""
    if len(channel_ids) > MAX_BATCH:
        raise ValueError(f"channels.list admite como máximo {MAX_BATCH} IDs")
    response = await client.get(
        CHANNELS_URL,
        params={"part": CHANNEL_PARTS, "id": ",".join(channel_ids), "key": api_key,
                "maxResults": MAX_BATCH},
    )  # fmt: skip
    response.raise_for_status()
    fetched_at = db.now_iso()
    return [parse_channel_item(item, fetched_at) for item in response.json().get("items", [])]


def is_fresh(channel: ChannelInfo | None, max_age_days: int, now: datetime | None = None) -> bool:
    if channel is None or channel.fetched_at is None:
        return False
    fetched = datetime.fromisoformat(channel.fetched_at)
    return (now or datetime.now(UTC)) - fetched < timedelta(days=max_age_days)


class ChannelEnricher:
    """Agrupa canales pendientes y los resuelve por lotes."""

    def __init__(
        self,
        database: db.Database,
        client: httpx.AsyncClient,
        api_key: str | None,
        flush_seconds: float = 10.0,
        cache_days: int = 30,
    ) -> None:
        self._db = database
        self._client = client
        self._api_key = api_key
        self._flush_seconds = flush_seconds
        self._cache_days = cache_days
        self._pending: set[str] = set()
        self._lock = asyncio.Lock()

    @property
    def has_api_key(self) -> bool:
        return bool(self._api_key)

    @property
    def pending(self) -> frozenset[str]:
        return frozenset(self._pending)

    def is_cached(self, channel_id: str) -> bool:
        with self._db.connect() as conn:
            return is_fresh(db.get_channel(conn, channel_id), self._cache_days)

    async def enqueue(self, channel_id: str) -> None:
        """Añade un canal a la cola; si ya está en caché y fresco, marca L2 ok al momento."""
        if self.is_cached(channel_id):
            self._set_status([channel_id], "ok")
            return
        self._pending.add(channel_id)
        if len(self._pending) >= MAX_BATCH:
            await self.flush()

    def enqueue_many(self, channel_ids: Iterable[str]) -> None:
        """Encola sin vaciar (p. ej. al arrancar); el bucle periódico hará el resto."""
        self._pending.update(channel_ids)

    async def flush(self) -> None:
        async with self._lock:
            while self._pending:
                batch = sorted(self._pending)[:MAX_BATCH]
                self._pending.difference_update(batch)
                await self._resolve_batch(batch)

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(self._flush_seconds)
            try:
                await self.flush()
            except Exception:  # el bucle no debe morir nunca
                log.exception("Channel flush failed")

    async def _resolve_batch(self, batch: list[str]) -> None:
        if not self._api_key:
            log.warning("YOUTUBE_API_KEY missing: L2 marked as error for %d channels", len(batch))
            self._set_status(batch, "error")
            return
        try:
            channels = await fetch_channels(self._client, self._api_key, batch)
        except httpx.HTTPError as exc:
            log.warning("channels.list failed: %s", exc)
            self._set_status(batch, "error")
            return
        found = {c.channel_id for c in channels}
        with self._db.connect() as conn:
            for channel in channels:
                db.upsert_channel(conn, channel)
            db.set_l2_status_for_channels(conn, found, "ok")
            db.set_l2_status_for_channels(conn, set(batch) - found, "error")

    def _set_status(self, channel_ids: Iterable[str], status: str) -> None:
        with self._db.connect() as conn:
            db.set_l2_status_for_channels(conn, channel_ids, status)

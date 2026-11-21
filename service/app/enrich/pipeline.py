"""Orquestación del enriquecimiento.

- `ingest`: síncrono y barato. Limpia la descripción, muestrea la transcripción y guarda.
- `enrich`: asíncrono (tarea en segundo plano). Encola el canal (L2) y recorta fotogramas (L4).
"""

import logging
import sqlite3
from pathlib import Path

import httpx

from app import db
from app.enrich.channel import ChannelEnricher
from app.enrich.description import clean_description
from app.enrich.frames import extract_frames
from app.enrich.transcript import sample_transcript
from app.models import FichaIn, FichaOut, FrameInfo, StoryboardIn

log = logging.getLogger(__name__)


class EnrichmentPipeline:
    def __init__(
        self,
        database: db.Database,
        client: httpx.AsyncClient,
        channels: ChannelEnricher,
        data_dir: Path,
    ) -> None:
        self._db = database
        self._client = client
        self._channels = channels
        self._data_dir = data_dir

    def ingest(self, ficha: FichaIn) -> FichaOut:
        """Guarda (o actualiza) la ficha con los pasos de texto ya hechos."""
        ok_transcript = ficha.transcript.status == "ok"
        excerpt = sample_transcript(ficha.transcript.segments) if ok_transcript else ""
        with self._db.connect() as conn:
            previous = db.get_video_row(conn, ficha.video_id)
            db.upsert_video(
                conn,
                ficha,
                description_clean=clean_description(ficha.metadata.description_raw),
                transcript_excerpt=excerpt,
                l2_status=self._initial_l2_status(ficha),
                l4_status=_initial_l4_status(ficha, previous),
            )
            stored = db.load_ficha(conn, ficha.video_id)
        assert stored is not None
        return stored

    async def enrich(self, video_id: str) -> None:
        with self._db.connect() as conn:
            row = db.get_video_row(conn, video_id)
        if row is None:
            return
        if row["channel_id"] and row["l2_status"] == "pending":
            await self._channels.enqueue(row["channel_id"])
        if row["l4_status"] == "pending":
            await self.enrich_frames(video_id)

    async def enrich_frames(self, video_id: str) -> None:
        with self._db.connect() as conn:
            storyboard = db.get_storyboard(conn, video_id)
        try:
            frames = await extract_frames(self._client, video_id, storyboard, self._data_dir)
        except (httpx.HTTPError, OSError) as exc:
            log.warning("Frame extraction failed for %s: %s", video_id, exc)
            self._set_l4(video_id, "error")
            return
        with self._db.connect() as conn:
            db.replace_frames(conn, video_id, frames)
            db.set_l4_status(conn, video_id, _frames_status(frames, storyboard))

    def resume(self) -> list[str]:
        """Al arrancar: reencola canales sin L2 (y con error si hay clave de API) y devuelve
        los vídeos cuyo L4 hay que (re)intentar. Máximo MAX_ENRICH_ATTEMPTS fallos por vídeo."""
        with self._db.connect() as conn:
            retry_l2 = self._channels.has_api_key
            self._channels.enqueue_many(db.channels_needing_enrichment(conn, retry_l2))
            return db.videos_needing_frames(conn)

    def _initial_l2_status(self, ficha: FichaIn) -> str:
        channel_id = ficha.metadata.channel_id
        if not channel_id:
            return "error"
        return "ok" if self._channels.is_cached(channel_id) else "pending"

    def _set_l4(self, video_id: str, status: str) -> None:
        with self._db.connect() as conn:
            db.set_l4_status(conn, video_id, status)


def _frames_status(frames: list[FrameInfo], storyboard: StoryboardIn | None) -> str:
    """Sin storyboard, no tener ni miniatura es "none"; con storyboard es un "error"."""
    if frames:
        return "ok"
    return "none" if storyboard is None else "error"


def _initial_l4_status(ficha: FichaIn, previous: sqlite3.Row | None) -> str:
    """Si ya había fotogramas, no se repite la descarga al volver a abrir el vídeo."""
    if previous is not None and previous["l4_status"] == "ok":
        return "ok"
    return "pending"

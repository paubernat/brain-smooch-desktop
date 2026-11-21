"""L4 sin storyboard (solo miniatura) y reintentos de enriquecimiento al arrancar."""

import sqlite3
from pathlib import Path

import httpx
import respx

from app import db
from app.enrich.channel import ChannelEnricher
from app.enrich.pipeline import EnrichmentPipeline
from app.models import FichaIn
from tests.helpers import CHANNEL_ID, LEVEL, VIDEO_ID, ficha_payload, make_sprite, png_bytes

HQ_URL = f"https://i.ytimg.com/vi/{VIDEO_ID}/hqdefault.jpg"


def add_video(database: db.Database, *, l2: str = "pending", l4: str = "pending") -> None:
    ficha = FichaIn.model_validate(ficha_payload(with_storyboard=False))
    with database.connect() as conn:
        db.upsert_video(
            conn, ficha, description_clean="", transcript_excerpt="", l2_status=l2, l4_status=l4
        )


def video_row(database: db.Database) -> sqlite3.Row:
    with database.connect() as conn:
        row = db.get_video_row(conn, VIDEO_ID)
    assert row is not None
    return row


def make_pipeline(
    database: db.Database, client: httpx.AsyncClient, data_dir: Path, api_key: str | None
) -> EnrichmentPipeline:
    channels = ChannelEnricher(database, client, api_key)
    return EnrichmentPipeline(database, client, channels, data_dir)


@respx.mock
async def test_no_storyboard_falls_back_to_hqdefault(database: db.Database, tmp_path: Path) -> None:
    add_video(database)
    respx.get(url__regex=r".*/(maxres|sd)default\.jpg").mock(return_value=httpx.Response(404))
    respx.get(HQ_URL).mock(
        return_value=httpx.Response(200, content=png_bytes(make_sprite(LEVEL, 0)))
    )
    async with httpx.AsyncClient() as client:
        await make_pipeline(database, client, tmp_path, "k").enrich_frames(VIDEO_ID)
    assert video_row(database)["l4_status"] == "ok"
    with database.connect() as conn:
        assert [f.kind for f in db.get_frames(conn, VIDEO_ID)] == ["thumbnail"]


@respx.mock
async def test_no_storyboard_and_no_thumbnail_is_none(
    database: db.Database, tmp_path: Path
) -> None:
    add_video(database)
    respx.get(url__regex=r"https://i\.ytimg\.com/.*").mock(return_value=httpx.Response(404))
    async with httpx.AsyncClient() as client:
        await make_pipeline(database, client, tmp_path, "k").enrich_frames(VIDEO_ID)
    row = video_row(database)
    assert row["l4_status"] == "none" and row["l4_attempts"] == 0


def test_l4_errors_are_retried_at_most_three_times(database: db.Database, tmp_path: Path) -> None:
    add_video(database)
    pipeline = make_pipeline(database, httpx.AsyncClient(), tmp_path, "k")
    for attempt in range(1, 4):
        with database.connect() as conn:
            db.set_l4_status(conn, VIDEO_ID, "error")
        assert video_row(database)["l4_attempts"] == attempt
        expected = [VIDEO_ID] if attempt < 3 else []
        assert pipeline.resume() == expected


def test_l2_errors_retried_only_with_api_key(database: db.Database, tmp_path: Path) -> None:
    add_video(database)
    with database.connect() as conn:
        db.set_l2_status_for_channels(conn, [CHANNEL_ID], "error")
    without_key = make_pipeline(database, httpx.AsyncClient(), tmp_path, None)
    without_key.resume()
    assert without_key._channels.pending == frozenset()

    with_key = make_pipeline(database, httpx.AsyncClient(), tmp_path, "k")
    with_key.resume()
    assert with_key._channels.pending == {CHANNEL_ID}

    with database.connect() as conn:
        db.set_l2_status_for_channels(conn, [CHANNEL_ID], "error")
        db.set_l2_status_for_channels(conn, [CHANNEL_ID], "error")
        assert db.channels_needing_enrichment(conn, include_errors=True) == []


def test_old_database_gets_attempt_columns(tmp_path: Path) -> None:
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE videos (video_id TEXT PRIMARY KEY, channel_id TEXT, title TEXT NOT NULL, "
            "l2_status TEXT, l4_status TEXT)"
        )
    db.Database(path).init()
    with sqlite3.connect(path) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(videos)")}
    assert {"l2_attempts", "l4_attempts"} <= columns

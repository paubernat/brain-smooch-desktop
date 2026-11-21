from datetime import UTC, datetime, timedelta

import httpx
import pytest
import respx

from app import db
from app.enrich.channel import (
    CHANNELS_URL,
    MAX_BATCH,
    ChannelEnricher,
    is_fresh,
    parse_channel_item,
    topic_name,
)
from app.models import ChannelInfo, FichaIn
from tests.helpers import CHANNEL_ID, channel_api_item, ficha_payload


def add_video(database: db.Database, video_id: str, channel_id: str) -> None:
    ficha = FichaIn.model_validate(ficha_payload(video_id, channel_id=channel_id))
    with database.connect() as conn:
        db.upsert_video(
            conn, ficha, description_clean="", transcript_excerpt="",
            l2_status="pending", l4_status="none",
        )  # fmt: skip


def l2_status(database: db.Database, video_id: str) -> str:
    with database.connect() as conn:
        row = db.get_video_row(conn, video_id)
    assert row is not None
    return row["l2_status"]


def test_topic_name_takes_last_segment() -> None:
    assert topic_name("https://en.wikipedia.org/wiki/Video_game_culture") == "Video_game_culture"
    assert topic_name("https://en.wikipedia.org/wiki/Music/") == "Music"


def test_parse_channel_item() -> None:
    channel = parse_channel_item(channel_api_item(), "2026-01-01T00:00:00+00:00")
    assert channel.topics == ["Music", "Jazz"]
    assert channel.description == "Jazz & R&B piano lessons."
    assert channel.keywords == 'piano jazz "music theory"'


def test_is_fresh() -> None:
    now = datetime(2026, 6, 1, tzinfo=UTC)
    recent = ChannelInfo(channel_id="c", fetched_at=(now - timedelta(days=29)).isoformat())
    stale = ChannelInfo(channel_id="c", fetched_at=(now - timedelta(days=31)).isoformat())
    assert is_fresh(recent, 30, now)
    assert not is_fresh(stale, 30, now)
    assert not is_fresh(None, 30, now)


@respx.mock
async def test_flush_fetches_batch_and_marks_l2(database: db.Database) -> None:
    add_video(database, "vid1", CHANNEL_ID)
    add_video(database, "vid2", "UCmissing")
    route = respx.get(CHANNELS_URL).mock(
        return_value=httpx.Response(200, json={"items": [channel_api_item()]})
    )
    async with httpx.AsyncClient() as client:
        enricher = ChannelEnricher(database, client, "test-key")
        await enricher.enqueue(CHANNEL_ID)
        await enricher.enqueue("UCmissing")
        assert not route.called  # aún no: se espera al temporizador o a 50
        await enricher.flush()

    assert route.call_count == 1
    params = route.calls[0].request.url.params
    assert params["part"] == "snippet,topicDetails,brandingSettings"
    assert set(params["id"].split(",")) == {CHANNEL_ID, "UCmissing"}
    assert params["key"] == "test-key"
    assert l2_status(database, "vid1") == "ok"
    assert l2_status(database, "vid2") == "error"
    with database.connect() as conn:
        stored = db.get_channel(conn, CHANNEL_ID)
    assert stored is not None and stored.topics == ["Music", "Jazz"]


def _echo_channels(request: httpx.Request) -> httpx.Response:
    ids = request.url.params["id"].split(",")
    return httpx.Response(200, json={"items": [channel_api_item(c) for c in ids]})


@respx.mock
async def test_reaching_50_flushes_immediately(database: db.Database) -> None:
    ids = [f"UC{i:022d}" for i in range(MAX_BATCH + 1)]
    route = respx.get(CHANNELS_URL).mock(side_effect=_echo_channels)
    async with httpx.AsyncClient() as client:
        enricher = ChannelEnricher(database, client, "test-key")
        for channel_id in ids:
            await enricher.enqueue(channel_id)
        assert route.call_count == 1
        assert len(route.calls[0].request.url.params["id"].split(",")) == MAX_BATCH
        assert enricher.pending == {ids[-1]}


@respx.mock
async def test_cached_channel_is_not_fetched_again(database: db.Database) -> None:
    add_video(database, "vid1", CHANNEL_ID)
    with database.connect() as conn:
        db.upsert_channel(conn, parse_channel_item(channel_api_item(), db.now_iso()))
    route = respx.get(CHANNELS_URL)
    async with httpx.AsyncClient() as client:
        enricher = ChannelEnricher(database, client, "test-key")
        await enricher.enqueue(CHANNEL_ID)
        await enricher.flush()
    assert not route.called
    assert l2_status(database, "vid1") == "ok"


async def test_missing_api_key_marks_error(database: db.Database) -> None:
    add_video(database, "vid1", CHANNEL_ID)
    async with httpx.AsyncClient() as client:
        enricher = ChannelEnricher(database, client, None)
        await enricher.enqueue(CHANNEL_ID)
        await enricher.flush()
    assert l2_status(database, "vid1") == "error"


@pytest.mark.parametrize("status", [403, 500])
@respx.mock
async def test_api_error_marks_error(database: db.Database, status: int) -> None:
    add_video(database, "vid1", CHANNEL_ID)
    respx.get(CHANNELS_URL).mock(return_value=httpx.Response(status))
    async with httpx.AsyncClient() as client:
        enricher = ChannelEnricher(database, client, "test-key")
        await enricher.enqueue(CHANNEL_ID)
        await enricher.flush()
    assert l2_status(database, "vid1") == "error"

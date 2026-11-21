from collections.abc import Iterator

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app.config import Settings
from app.enrich.channel import CHANNELS_URL
from app.main import create_app
from tests.helpers import (
    LEVEL,
    VIDEO_ID,
    channel_api_item,
    ficha_payload,
    make_sprite,
    png_bytes,
    sprite_urls,
)

EXT_ORIGIN = "moz-extension://4b1c2d3e-0000-4000-8000-123456789abc"


@pytest.fixture
def mock_net() -> Iterator[respx.MockRouter]:
    """Toda la red simulada: miniaturas, sprites y YouTube Data API. Nada sale fuera."""
    with respx.mock(assert_all_called=False) as router:
        router.get(url__regex=r"https://i\.ytimg\.com/vi/.*").mock(
            return_value=httpx.Response(200, content=png_bytes(make_sprite(LEVEL, 0)))
        )
        for n, url in enumerate(sprite_urls()):
            router.get(url).mock(
                return_value=httpx.Response(200, content=png_bytes(make_sprite(LEVEL, n)))
            )
        router.get(CHANNELS_URL).mock(
            return_value=httpx.Response(200, json={"items": [channel_api_item()]})
        )
        router.route(host="testserver").pass_through()
        yield router


@pytest.fixture
def client(settings: Settings, mock_net: respx.MockRouter) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def test_health(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "ok"}


def test_cors_allows_only_extension_origin(client: TestClient) -> None:
    preflight = {"Access-Control-Request-Method": "POST"}
    ok = client.options("/fichas", headers={"Origin": EXT_ORIGIN, **preflight})
    assert ok.headers.get("access-control-allow-origin") == EXT_ORIGIN
    bad = client.options("/fichas", headers={"Origin": "https://evil.example", **preflight})
    assert "access-control-allow-origin" not in bad.headers


def test_post_ficha_returns_stored_ficha(client: TestClient) -> None:
    response = client.post("/fichas", json=ficha_payload())
    assert response.status_code == 200
    body = response.json()
    assert body["video_id"] == VIDEO_ID
    assert body["levels"] == {"L1": "ok", "L2": "pending", "L3": "ok", "L4": "pending"}
    assert body["label"] is None
    assert "Chord Theory for R&B Piano" in body["metadata"]["description_clean"]
    assert "http" not in body["metadata"]["description_clean"]
    assert body["transcript"]["excerpt"].startswith("[00:00] segment 0")
    assert body["transcript"]["segment_count"] == 80


def test_background_enrichment_completes_l4_and_l2_after_flush(client: TestClient) -> None:
    client.post("/fichas", json=ficha_payload())
    ficha = client.get(f"/fichas/{VIDEO_ID}").json()
    assert ficha["levels"]["L4"] == "ok"
    assert [f["kind"] for f in ficha["frames"]] == ["thumbnail"] + ["frame"] * 6
    assert ficha["levels"]["L2"] == "pending"  # en cola hasta el siguiente vaciado

    channels = client.app.state.ctx.channels  # type: ignore[attr-defined]
    client.portal.call(channels.flush)  # type: ignore[union-attr]
    ficha = client.get(f"/fichas/{VIDEO_ID}").json()
    assert ficha["levels"]["L2"] == "ok"
    assert ficha["channel"]["topics"] == ["Music", "Jazz"]


def test_ficha_without_storyboard_or_transcript(client: TestClient) -> None:
    payload = ficha_payload(with_storyboard=False, transcript_status="blocked", channel_id=None)
    body = client.post("/fichas", json=payload).json()
    assert body["levels"] == {"L1": "ok", "L2": "error", "L3": "blocked", "L4": "pending"}
    assert body["transcript"]["excerpt"] == ""
    # Sin storyboard se guarda igualmente la miniatura → L4 ok
    ficha = client.get(f"/fichas/{VIDEO_ID}").json()
    assert ficha["levels"]["L4"] == "ok"
    assert [f["kind"] for f in ficha["frames"]] == ["thumbnail"]


def test_post_ficha_is_idempotent_and_keeps_label(client: TestClient) -> None:
    first = client.post("/fichas", json=ficha_payload()).json()
    client.post("/labels", json={"video_id": VIDEO_ID, "label": "LIBRE"})
    payload = ficha_payload()
    payload["metadata"]["title"] = "Updated title"
    second = client.post("/fichas", json=payload).json()
    assert second["created_at"] == first["created_at"]
    assert second["metadata"]["title"] == "Updated title"
    assert second["label"]["label"] == "LIBRE"
    assert second["levels"]["L4"] == "ok"  # no se repite la descarga de fotogramas


def test_get_missing_ficha_is_404(client: TestClient) -> None:
    assert client.get("/fichas/nope").status_code == 404


def test_label_flow_and_stats(client: TestClient) -> None:
    client.post("/fichas", json=ficha_payload())
    response = client.post(
        "/labels", json={"video_id": VIDEO_ID, "label": "LIBRE", "reason": "jazz chords"}
    )
    assert response.status_code == 200
    label = response.json()
    assert label["label"] == "LIBRE" and label["split"] == "dev" and label["labeled_at"]

    relabel = client.post("/labels", json={"video_id": VIDEO_ID, "label": "LIMITADO"}).json()
    assert relabel["split"] == "dev" and relabel["reason"] is None

    ficha = client.get(f"/fichas/{VIDEO_ID}").json()
    assert ficha["label"]["label"] == "LIMITADO"

    stats = client.get("/labels/stats").json()
    assert stats == {
        "total": 1,
        "by_label": {"NO": 0, "LIMITADO": 1, "LIBRE": 0},
        "by_split": {"dev": 1, "test": 0},
        "shorts": 1,
        "with_transcript": 1,
    }


def test_label_unknown_video_is_404(client: TestClient) -> None:
    response = client.post("/labels", json={"video_id": "nope", "label": "NO"})
    assert response.status_code == 404


def test_invalid_label_is_422(client: TestClient) -> None:
    client.post("/fichas", json=ficha_payload())
    response = client.post("/labels", json={"video_id": VIDEO_ID, "label": "MAYBE"})
    assert response.status_code == 422


def test_channel_history_counts_other_videos(client: TestClient) -> None:
    for video_id in ("aaa", "bbb", VIDEO_ID):
        client.post("/fichas", json=ficha_payload(video_id, with_storyboard=False))
    client.post("/labels", json={"video_id": "aaa", "label": "LIBRE"})
    client.post("/labels", json={"video_id": "bbb", "label": "NO"})
    client.post("/labels", json={"video_id": VIDEO_ID, "label": "LIBRE"})
    history = client.get(f"/fichas/{VIDEO_ID}").json()["channel_history"]
    assert history == {"NO": 1, "LIMITADO": 0, "LIBRE": 1}

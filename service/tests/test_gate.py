"""Decisión del gate (H1) en `/verdicts`, ajustes de bloqueo y web local."""

from fastapi.testclient import TestClient

from app.enforcement import gate_decision
from app.models import Label
from tests.test_live_judge import (  # noqa: F401  (fixtures)
    VIDEO,
    FakeJudge,
    add_video,
    client,
    database,
    judge,
)


def test_gate_decision_threshold() -> None:
    assert gate_decision(Label.LIBRE, 0.9, from_rule=False, min_confidence=0.6).action == "allow"
    low = gate_decision(Label.LIBRE, 0.5, from_rule=False, min_confidence=0.6)
    assert low.action == "limit" and low.label == Label.LIMITADO and low.low_confidence
    assert gate_decision(Label.NO, 0.9, from_rule=False, min_confidence=0.6).action == "block"
    no_low = gate_decision(Label.NO, 0.4, from_rule=False, min_confidence=0.6)
    assert no_low.action == "block" and not no_low.low_confidence
    assert gate_decision(Label.LIMITADO, 0.9, from_rule=False, min_confidence=0.6).action == "limit"
    rule = gate_decision(Label.NO, 1.0, from_rule=True, min_confidence=1.0)
    assert rule.action == "block" and not rule.low_confidence


def test_verdict_carries_gate_even_when_hidden(client: TestClient, judge: FakeJudge) -> None:  # noqa: F811
    add_video(database(client))
    body = client.post(f"/verdicts/{VIDEO}").json()
    assert body["revealed"] is False and body["label"] is None
    assert body["gate"] == {
        "action": "allow",
        "label": "LIBRE",
        "low_confidence": False,
        "source": "model",
        "rule": None,
        "confidence": 0.7,
    }
    live = client.get("/settings/live").json()
    client.put("/settings/live", json={**live, "min_confidence": 0.9})
    assert client.post(f"/verdicts/{VIDEO}").json()["gate"]["action"] == "limit"


def test_enforcement_marks_verdict_as_seen(client: TestClient) -> None:  # noqa: F811
    add_video(database(client))
    assert client.get("/settings/enforcement").json() == {
        "mode": "off",
        "service_timeout_s": 6.0,
        "decision_timeout_s": 45.0,
        "block_shorts_feed": True,
    }
    client.post(f"/verdicts/{VIDEO}")
    label = client.post("/labels", json={"video_id": VIDEO, "label": "LIBRE"}).json()
    assert label["verdict_seen_before_label"] is False
    # Con el bloqueo activo el gate actúa según el veredicto: cuenta como visto.
    other = "live-vid-02"
    add_video(database(client), other)
    client.put("/settings/enforcement", json={"mode": "soft"})
    client.post(f"/verdicts/{other}")
    label = client.post("/labels", json={"video_id": other, "label": "LIMITADO"}).json()
    assert label["verdict_seen_before_label"] is True


def test_ui_settings_and_web_index(client: TestClient) -> None:  # noqa: F811
    assert client.get("/settings/ui").json() == {"language": None}
    assert client.put("/settings/ui", json={"language": "ca"}).json() == {"language": "ca"}
    assert client.put("/settings/ui", json={"language": "fr"}).status_code == 422
    index = client.get("/")
    assert index.status_code in (200, 503)
    assert "text/html" in index.headers["content-type"]
    assert client.get("/health").json() == {"status": "ok"}  # la API gana a la web

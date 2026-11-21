"""Juez en directo (`/verdicts`, `/settings/live`) y guarda contra la fuga de etiquetas.

FakeJudge, sin red ni gasto."""

import sqlite3
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.live_judge import PARTIAL_SUFFIX
from app.main import create_app
from app.models import FichaIn
from app.policy import load_policy
from app.routes.deps import get_judge_factory
from eval import ablation
from tests.helpers import ficha_payload
from tests.test_policy_api import FakeJudge

VIDEO = "live-vid-01"


def add_video(
    database: db.Database, video_id: str = VIDEO, *, l2: str = "ok", ai_labeled: bool = False
) -> None:
    payload = ficha_payload(video_id, with_storyboard=False)
    payload["metadata"]["ai_disclosure"] = {"labeled": ai_labeled, "source": "next"}
    with database.connect() as conn:
        db.upsert_video(
            conn,
            FichaIn.model_validate(payload),
            description_clean="clean",
            transcript_excerpt="[00:00] text",
            l2_status=l2,
            l4_status="none",
        )


@pytest.fixture
def judge() -> FakeJudge:
    return FakeJudge()


@pytest.fixture
def client(policy_settings: Settings, judge: FakeJudge) -> Iterator[TestClient]:
    policy_settings.live_wait_s = 0.0
    policy_settings.live_poll_s = 0.0
    app = create_app(policy_settings)
    app.dependency_overrides[get_judge_factory] = lambda: lambda key, require_key: judge
    with TestClient(app) as test_client:
        yield test_client


def database(client: TestClient) -> db.Database:
    return client.app.state.ctx.database  # type: ignore[attr-defined]


def test_live_settings_defaults_and_validation(client: TestClient) -> None:
    assert client.get("/settings/live").json() == {
        "judge": "liquid/d1.2-ultra",
        "config": "D",
        "reveal": "after_label",
        "min_confidence": 0.6,
    }
    body = {"judge": "liquid/d1.2", "config": "E", "reveal": "always", "min_confidence": 0.8}
    assert client.put("/settings/live", json=body).json() == body
    assert client.get("/settings/live").json() == body
    assert client.put("/settings/live", json={**body, "judge": "nope"}).status_code == 422
    assert client.put("/settings/live", json={**body, "config": "D+L0"}).status_code == 422


def test_hidden_until_labeled_and_cached(client: TestClient, judge: FakeJudge) -> None:
    add_video(database(client))
    assert client.get(f"/verdicts/{VIDEO}").status_code == 404  # aún no hay veredicto

    first = client.post(f"/verdicts/{VIDEO}").json()
    assert first["revealed"] is False and first["label"] is None and first["probs"] is None
    assert first["cached"] is False and first["cost_usd"] == pytest.approx(0.001)
    assert first["judge"] == "liquid/d1.2-ultra" and first["config"] == "D"

    second = client.post(f"/verdicts/{VIDEO}").json()
    assert second["cached"] is True and second["cost_usd"] == 0
    assert len(judge.seen) == 1  # la segunda vez no se paga

    label = client.post("/labels", json={"video_id": VIDEO, "label": "NO"}).json()
    assert label["verdict_seen_before_label"] is False

    shown = client.get(f"/verdicts/{VIDEO}").json()
    assert shown["revealed"] is True and shown["label"] == "LIBRE" and shown["source"] == "model"
    assert shown["confidence"] == pytest.approx(0.7)
    assert set(shown["probs"]) == {"NO", "LIMITADO", "LIBRE"}
    # Re-etiquetar después de ver el veredicto ya cuenta como fuga.
    relabel = client.post("/labels", json={"video_id": VIDEO, "label": "LIBRE"}).json()
    assert relabel["verdict_seen_before_label"] is True


def test_reveal_always_marks_label_and_ablation_excludes_it(
    client: TestClient, policy_settings: Settings
) -> None:
    data = database(client)
    add_video(data)
    add_video(data, "live-vid-02")
    client.put("/settings/live", json={"judge": "liquid/d1.2", "config": "D", "reveal": "always"})

    shown = client.post(f"/verdicts/{VIDEO}").json()
    assert shown["revealed"] is True and shown["label"] == "LIBRE"
    seen = client.post("/labels", json={"video_id": VIDEO, "label": "LIBRE"}).json()
    blind = client.post("/labels", json={"video_id": "live-vid-02", "label": "NO"}).json()
    assert seen["verdict_seen_before_label"] is True
    assert blind["verdict_seen_before_label"] is False

    ids = [v.ficha.video_id for v in ablation.load_dataset(data, None)]
    assert ids == ["live-vid-02"]
    ids = [v.ficha.video_id for v in ablation.load_dataset(data, None, include_seen=True)]
    assert sorted(ids) == [VIDEO, "live-vid-02"]
    with data.connect() as conn:
        assert db.count_seen_labels(conn) == 1


def test_rule_decides_without_the_model(client: TestClient, judge: FakeJudge) -> None:
    add_video(database(client), ai_labeled=True)
    policy = client.get("/policy").json()
    content = {**policy["content"], "rules": {"block_ai_labeled": True, "block_live": False}}
    assert client.put("/policy", json={"content": content}).status_code == 200
    client.put("/settings/live", json={"judge": "liquid/d1.2", "config": "D", "reveal": "always"})

    verdict = client.post(f"/verdicts/{VIDEO}").json()
    assert verdict["source"] == "rule" and verdict["rule"] == "block_ai_labeled"
    assert verdict["label"] == "NO" and verdict["confidence"] == 1.0
    assert judge.seen == []
    assert client.get(f"/verdicts/{VIDEO}").json()["source"] == "rule"


def test_missing_levels_give_a_partial_verdict_outside_the_ablation_cache(
    client: TestClient, judge: FakeJudge, policy_settings: Settings
) -> None:
    data = database(client)
    add_video(data, l2="pending")  # D necesita L2 (canal)
    verdict = client.post(f"/verdicts/{VIDEO}").json()
    assert verdict["partial"] is True and verdict["cached"] is False
    assert client.post(f"/verdicts/{VIDEO}").json()["cached"] is True
    assert len(judge.seen) == 1

    policy = load_policy(policy_settings.policy_path)
    assert ablation.find_cached(data, VIDEO, judge, "D", policy) is None
    assert ablation.find_cached(data, VIDEO, judge, "D" + PARTIAL_SUFFIX, policy) is not None


def test_unknown_video_is_404(client: TestClient) -> None:
    assert client.post("/verdicts/nope").status_code == 404


def test_labels_table_migration(tmp_path: Path) -> None:
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as conn:
        conn.execute(
            "CREATE TABLE labels (video_id TEXT PRIMARY KEY, label TEXT NOT NULL, "
            "reason TEXT, labeled_at TEXT NOT NULL, split TEXT NOT NULL)"
        )
        conn.execute("INSERT INTO labels VALUES ('v', 'NO', NULL, '2026-01-01', 'dev')")
    db.Database(path).init()
    with sqlite3.connect(path) as conn:
        row = conn.execute("SELECT verdict_seen_before_label FROM labels").fetchone()
    assert row == (0,)

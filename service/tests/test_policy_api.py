"""Endpoints `/policy*` y `/judges` con FakeJudge y Anthropic simulado. Sin red ni gasto."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app import db
from app.anthropic_api import ANTHROPIC_URL
from app.config import Settings
from app.main import create_app
from app.models import FichaIn, FichaView, Label, Verdict
from app.policy import Policy
from app.routes.deps import get_judge_factory
from tests.helpers import ficha_payload
from tests.test_policy_author import DRAFT_OUTPUT, anthropic_body

N_DEV = 12
N_TEST = 3
LABEL_CYCLE = [Label.LIBRE, Label.LIMITADO, Label.NO]


@dataclass
class FakeJudge:
    """Siempre dice LIBRE: acierta los LIBRE y da falsos LIBRE en el resto."""

    name: str = "liquid/d1.2"  # con precio en pricing.yaml
    provider: str = "fake"
    model: str = "m"
    supports_images: bool = True
    seen: list[str] = field(default_factory=list)

    async def decide(self, ficha: FichaView, policy: Policy) -> Verdict:
        assert ficha.video is not None
        self.seen.append(ficha.video.title)
        probs = {Label.LIBRE: 0.7, Label.LIMITADO: 0.2, Label.NO: 0.1}
        return Verdict(label=Label.LIBRE, probs=probs, confidence=0.7, cost_usd=0.001)


def seed(database: db.Database, n_dev: int, n_test: int) -> None:
    with database.connect() as conn:
        rows = [(f"dev-{i:02d}", "dev") for i in range(n_dev)]
        rows += [(f"test-{i:02d}", "test") for i in range(n_test)]
        for i, (video_id, split) in enumerate(rows):
            payload = ficha_payload(video_id, channel_id=None, with_storyboard=False)
            payload["metadata"]["title"] = video_id
            db.upsert_video(
                conn,
                FichaIn.model_validate(payload),
                description_clean="clean",
                transcript_excerpt="[00:00] text",
                l2_status="ok",
                l4_status="none",
            )
            db.upsert_label(conn, video_id, LABEL_CYCLE[i % 3], None)
            conn.execute("UPDATE labels SET split = ? WHERE video_id = ?", (split, video_id))


@pytest.fixture
def judge() -> FakeJudge:
    return FakeJudge()


@contextmanager
def running_client(settings: Settings, judge: FakeJudge, n_dev: int) -> Iterator[TestClient]:
    app = create_app(settings)
    app.dependency_overrides[get_judge_factory] = lambda: lambda key, require_key: judge
    with TestClient(app) as client:
        seed(app.state.ctx.database, n_dev, N_TEST)
        yield client


@pytest.fixture
def client(
    policy_settings: Settings, judge: FakeJudge, mock_net: respx.MockRouter
) -> Iterator[TestClient]:
    with running_client(policy_settings, judge, N_DEV) as test_client:
        yield test_client


def test_get_put_policy_and_history(client: TestClient) -> None:
    current = client.get("/policy").json()
    assert current["version"] == 3 and current["yaml"].startswith("version: 3")
    content = current["content"]
    content["question"]["instructions"] = "Instrucciones nuevas."
    content["channel_lists"]["NO"] = ["no", "NBA"]

    saved = client.put("/policy", json={"content": content, "expected_version": 3})
    assert saved.status_code == 200
    body = saved.json()
    assert body["version"] == 4 and '"NO":' in body["yaml"]
    assert body["content"]["channel_lists"]["NO"] == ["no", "NBA"]
    assert [h["version"] for h in client.get("/policy/history").json()] == [3]

    stale = client.put("/policy", json={"content": content, "expected_version": 3})
    assert stale.status_code == 409


def test_put_yaml_and_invalid(client: TestClient) -> None:
    text = client.get("/policy").json()["yaml"].replace("Clasifica", "Decide")
    assert client.put("/policy", json={"yaml": text}).json()["version"] == 4
    assert client.put("/policy", json={"yaml": "question: [1"}).status_code == 422
    assert client.put("/policy", json={}).status_code == 422


def test_put_blocked_sites(client: TestClient) -> None:
    content = client.get("/policy").json()["content"]
    assert content["blocked_sites"] == []
    content["blocked_sites"] = ["https://www.reddit.com/r/x", "twitch.tv"]
    body = client.put("/policy", json={"content": content}).json()
    assert body["content"]["blocked_sites"] == ["reddit.com", "twitch.tv"]
    assert client.get("/policy").json()["content"]["blocked_sites"] == ["reddit.com", "twitch.tv"]
    content["blocked_sites"] = ["localhost"]
    assert client.put("/policy", json={"content": content}).status_code == 422


def test_cors_allows_put(client: TestClient) -> None:
    headers = {"Origin": "moz-extension://abc", "Access-Control-Request-Method": "PUT"}
    assert client.options("/policy", headers=headers).status_code == 200


def test_judges_default_is_cheapest_with_key(client: TestClient) -> None:
    body = client.get("/judges").json()
    assert body["default_judge"] == "liquid/d1.2"
    assert body["default_config"] == "D"
    sonnet = next(j for j in body["judges"] if j["key"] == "anthropic/sonnet")
    assert sonnet["key_configured"] is True and "sk-test" not in json.dumps(body)


def test_evaluate_dry_run_then_run_uses_only_dev(client: TestClient, judge: FakeJudge) -> None:
    content = client.get("/policy").json()["content"]
    request = {"content": content, "judge": "liquid/d1.2", "config": "D"}

    dry = client.post("/policy/evaluate", json={**request, "dry_run": True}).json()
    assert dry["n_dev"] == N_DEV and dry["enough_labels"] is True
    assert dry["calls"] == N_DEV and dry["est_cost_usd"] > 0 and judge.seen == []

    run = client.post("/policy/evaluate", json={**request, "dry_run": False}).json()
    assert run["split"] == "dev" and run["n"] == N_DEV
    assert all(video_id.startswith("dev-") for video_id in judge.seen)
    assert run["false_libre"] == 8 and run["accuracy"] == pytest.approx(4 / 12)
    assert {e["predicted"] for e in run["errors"]} == {"LIBRE"}
    assert run["errors"][0]["url"].startswith("https://www.youtube.com/watch?v=dev-")

    cached = client.post("/policy/evaluate", json={**request, "dry_run": True}).json()
    assert cached["calls"] == 0 and cached["cached"] == N_DEV


def test_evaluate_with_few_labels(
    policy_settings: Settings, judge: FakeJudge, mock_net: respx.MockRouter
) -> None:
    with running_client(policy_settings, judge, n_dev=4) as client:
        content = client.get("/policy").json()["content"]
        run = client.post("/policy/evaluate", json={"content": content, "dry_run": False}).json()
    assert run["enough_labels"] is False and run["n_dev"] == 4 and judge.seen == []


def test_draft_and_refine(client: TestClient, mock_net: respx.MockRouter) -> None:
    output: dict[str, Any] = {**DRAFT_OUTPUT, "changelog": ["Más claro"]}
    route = mock_net.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(output))
    )
    prefs = {"libre": "piano jazz", "limitado": "Atrioc", "no": "NBA"}
    draft = client.post("/policy/draft", json={"preferences": prefs})
    assert draft.status_code == 200
    content = draft.json()["content"]
    assert content["question"]["options"]["NO"]["description"].startswith("League")

    errors = [
        {"video_id": "dev-01", "predicted": "LIBRE", "confidence": 0.7},
        {"video_id": "test-01", "predicted": "LIBRE", "confidence": 0.7},  # test: se ignora
        {"video_id": "dev-00", "predicted": "LIBRE", "confidence": 0.7},  # acierto: se ignora
    ]
    refined = client.post("/policy/refine", json={"draft": content, "errors": errors})
    assert refined.status_code == 200 and refined.json()["changelog"] == ["Más claro"]
    prompt = json.loads(route.calls.last.request.content)["messages"][0]["content"][0]["text"]
    assert "dev-01" in prompt and "test-01" not in prompt and "dev-00" not in prompt

    only_test = [errors[1]]
    assert (
        client.post("/policy/refine", json={"draft": content, "errors": only_test}).status_code
        == 422
    )
    assert client.post("/policy/draft", json={"preferences": {}}).status_code == 422


def test_draft_without_key(client: TestClient) -> None:
    client.app.state.ctx.settings.anthropic_api_key = None  # type: ignore[attr-defined]
    response = client.post("/policy/draft", json={"preferences": {"libre": "x"}})
    assert response.status_code == 503

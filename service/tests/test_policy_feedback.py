"""Recalibración con etiquetas pendientes y edición con instrucción (Anthropic simulado)."""

import json
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from app import db
from app.anthropic_api import ANTHROPIC_URL
from app.authoring.author import MAX_FEEDBACK_EXAMPLES, select_feedback
from app.authoring.models import FeedbackExample
from app.config import Settings
from app.models import Label
from tests.test_policy_api import N_DEV, N_TEST, FakeJudge, running_client
from tests.test_policy_author import DRAFT_OUTPUT, anthropic_body

REASON = "añade este canal a los limitados, no está mal"
REFRESH_OUTPUT: dict[str, Any] = {
    **DRAFT_OUTPUT,
    "channel_lists": {"NO": [], "LIMITADO": ["Atrioc", "Jeff Schneider"], "LIBRE": ["DeepSeek"]},
    "changelog": ["Jeff Schneider pasa a LIMITADO"],
}


@pytest.fixture
def client(policy_settings: Settings, mock_net: respx.MockRouter) -> Iterator[TestClient]:
    with running_client(policy_settings, FakeJudge(), N_DEV) as test_client:
        with test_client.app.state.ctx.database.connect() as conn:  # type: ignore[attr-defined]
            conn.execute("UPDATE labels SET reason = ? WHERE video_id = 'dev-01'", (REASON,))
        yield test_client


def _database(client: TestClient) -> db.Database:
    return client.app.state.ctx.database  # type: ignore[attr-defined]


def test_feedback_counts_both_splits(client: TestClient) -> None:
    body = client.get("/policy/feedback").json()
    assert body["pending"] == N_DEV + N_TEST and "pending_test" not in body
    assert sum(body["by_label"].values()) == N_DEV + N_TEST
    assert body["with_reason"] == 1 and body["hint_threshold"] == 20
    ids = [item["video_id"] for item in body["items"]]
    assert len(ids) == N_DEV + N_TEST and any(i.startswith("test-") for i in ids)
    reasons = {item["video_id"]: item["reason"] for item in body["items"]}
    assert reasons["dev-01"] == REASON
    assert client.get("/policy/feedback", params={"items": "false"}).json()["items"] == []


def test_refresh_then_save_marks_all_labels(client: TestClient, mock_net: respx.MockRouter) -> None:
    route = mock_net.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(REFRESH_OUTPUT))
    )
    response = client.post("/policy/refresh", json={})
    assert response.status_code == 200
    proposal = response.json()
    assert proposal["changelog"] == ["Jeff Schneider pasa a LIMITADO"]
    assert proposal["content"]["channel_lists"]["LIMITADO"] == ["Atrioc", "Jeff Schneider"]
    assert proposal["base_version"] == 3
    assert {ref["video_id"] for ref in proposal["feedback"]} == {
        f"dev-{i:02d}" for i in range(N_DEV)
    } | {f"test-{i:02d}" for i in range(N_TEST)}

    request = json.loads(route.calls.last.request.content)
    prompt = request["messages"][0]["content"][0]["text"]
    assert "test-00" in prompt  # el split test también se usa para recalibrar
    assert REASON in prompt
    assert prompt.index("con motivo") < prompt.index("sin motivo")
    assert "Fireship" in prompt  # la política vigente va con sus listas de canales
    schema = request["output_config"]["format"]["schema"]
    assert schema["properties"]["channel_lists"]["required"] == ["NO", "LIMITADO", "LIBRE"]

    # Alguien re-etiqueta un vídeo mientras se revisa la propuesta: ese queda pendiente.
    with _database(client).connect() as conn:
        db.upsert_label(conn, "dev-02", Label.NO, "cambio de opinión")
    stale = [{"video_id": "dev-03", "labeled_at": "x"}]  # labeled_at que no coincide
    saved = client.put(
        "/policy",
        json={
            "content": proposal["content"],
            "expected_version": proposal["base_version"],
            "incorporate": proposal["feedback"] + stale,
        },
    )
    assert saved.status_code == 200
    assert saved.json()["version"] == 4 and saved.json()["incorporated"] == N_DEV + N_TEST - 1

    after = client.get("/policy/feedback").json()
    assert after["pending"] == 1 and after["items"][0]["video_id"] == "dev-02"
    with _database(client).connect() as conn:
        versions = {r[0] for r in conn.execute("SELECT policy_version FROM policy_feedback")}
    assert versions == {4}


def test_refresh_threads_user_instruction(client: TestClient, mock_net: respx.MockRouter) -> None:
    route = mock_net.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(REFRESH_OUTPUT))
    )
    instruction = "  sé más estricto con los vídeos de reacción  "
    response = client.post("/policy/refresh", json={"instruction": instruction})
    assert response.status_code == 200
    request = json.loads(route.calls.last.request.content)
    prompt = request["messages"][0]["content"][0]["text"]
    assert "Indicación del usuario para esta revisión" in prompt
    assert "prioridad alta" in prompt and instruction.strip() in prompt
    # La indicación va antes de las etiquetas y el sistema explica cómo tratarla.
    assert prompt.index(instruction.strip()) < prompt.index("con motivo")
    system = request["system"]
    system_text = system if isinstance(system, str) else " ".join(b["text"] for b in system)
    assert "Indicación del usuario para esta revisión" in system_text

    # Sin indicación (o en blanco) no aparece la sección.
    client.post("/policy/refresh", json={"instruction": "   "})
    blank = json.loads(route.calls.last.request.content)["messages"][0]["content"][0]["text"]
    assert "Indicación del usuario" not in blank
    too_long = client.post("/policy/refresh", json={"instruction": "x" * 2001})
    assert too_long.status_code == 422
    assert client.get("/policy").json()["version"] == 3  # no guarda nada


def test_refresh_without_pending_labels(client: TestClient) -> None:
    refs = [
        {"video_id": i["video_id"], "labeled_at": i["labeled_at"]}
        for i in client.get("/policy/feedback").json()["items"]
    ]
    content = client.get("/policy").json()["content"]
    assert client.put("/policy", json={"content": content, "incorporate": refs}).status_code == 200
    assert client.post("/policy/refresh", json={}).status_code == 422
    assert client.post("/policy/refresh", json={"config": "Z"}).status_code == 400


def test_edit_applies_instruction(client: TestClient, mock_net: respx.MockRouter) -> None:
    output = {key: value for key, value in REFRESH_OUTPUT.items() if key not in ("rationale",)} | {
        "changelog": "  Quito Fireship de LIBRE.  "
    }
    route = mock_net.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(output))
    )
    policy = client.get("/policy").json()["content"]
    response = client.post(
        "/policy/edit", json={"policy": policy, "instruction": "quita lo de Fireship"}
    )
    assert response.status_code == 200
    result = response.json()
    assert result["changelog"] == "Quito Fireship de LIBRE."
    assert "Fireship" not in result["content"]["channel_lists"]["LIBRE"]
    request = json.loads(route.calls.last.request.content)
    assert "quita lo de Fireship" in request["messages"][0]["content"][0]["text"]
    assert request["output_config"]["format"]["schema"]["properties"]["changelog"] == {
        "type": "string"
    }
    assert client.get("/policy").json()["version"] == 3  # no guarda nada

    blank = client.post("/policy/edit", json={"policy": policy, "instruction": "   "})
    assert blank.status_code == 422


def test_edit_corrects_open_proposal(client: TestClient, mock_net: respx.MockRouter) -> None:
    output = {key: value for key, value in REFRESH_OUTPUT.items() if key not in ("rationale",)} | {
        "changelog": "Dejo LIBRE como estaba."
    }
    route = mock_net.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(output))
    )
    saved = client.get("/policy").json()["content"]
    response = client.post(
        "/policy/edit",
        json={"policy": saved, "instruction": "no toques LIBRE", "reference": saved},
    )
    assert response.status_code == 200
    request = json.loads(route.calls.last.request.content)
    text = request["messages"][0]["content"][0]["text"]
    assert "Política guardada (referencia)" in text
    assert "Propuesta en revisión" in text
    assert "no toques LIBRE" in text
    assert "corrección de esa propuesta" in json.dumps(request["system"], ensure_ascii=False)


def test_select_feedback_prefers_reasons_then_recent() -> None:
    def example(i: int, reason: str | None = None) -> FeedbackExample:
        return FeedbackExample(
            video_id=f"v{i}", labeled_at=f"2026-01-{i:02d}", label=Label.NO, reason=reason,
            summary={},
        )  # fmt: skip

    examples = [example(i) for i in range(1, 29)] + [example(i, "motivo") for i in range(29, 31)]
    examples += [example(31 + i) for i in range(MAX_FEEDBACK_EXAMPLES)]
    selected = select_feedback(examples)
    assert len(selected) == MAX_FEEDBACK_EXAMPLES
    assert [e.video_id for e in selected[:2]] == ["v30", "v29"]
    assert selected[2].labeled_at > selected[-1].labeled_at


def test_migration_adds_feedback_table(settings: Settings) -> None:
    database = db.Database(settings.db_path)
    database.init()
    with database.connect() as conn:
        conn.execute("DROP TABLE policy_feedback")  # base de datos anterior a la recalibración
    database.init()
    with database.connect() as conn:
        assert db.pending_labels(conn) == []
        assert db.mark_labels_incorporated(conn, [("missing", "x")], 1) == 0

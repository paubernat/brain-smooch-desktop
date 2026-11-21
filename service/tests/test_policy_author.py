"""Editor agéntico con respuestas de Anthropic simuladas (respx). Sin red ni gasto."""

import json
from typing import Any

import httpx
import pytest
import respx

from app.anthropic_api import ANTHROPIC_URL, ANTHROPIC_VERSION
from app.authoring.author import aux_id, draft_from_preferences, refine_with_errors
from app.authoring.client import AuthoringError, ClaudeAuthorClient
from app.authoring.models import ErrorExample, EvalSnapshot, Preferences
from app.config import REPO_ROOT
from app.judges.base import RetryableJudgeError
from app.models import Label
from app.policy import PolicyContent, load_policy
from app.pricing import load_pricing

DRAFT_OUTPUT = {
    "instructions": "Clasifica el vídeo según el uso que quiere hacer el usuario de YouTube.",
    "options": {
        "NO": "League of Legends, NBA, Shorts de relleno, slop de IA.",
        "LIMITADO": "Atrioc, dunkey, Ludwig. Ante la duda, LIMITADO.",
        "LIBRE": "Piano jazz con acordes en pantalla, tutoriales de Azure, Fireship.",
    },
    "auxiliary_questions": [
        {"id": "is_gaming", "instructions": "¿Trata de videojuegos?"},
        {"id": "Is Music Lesson!", "instructions": "¿Enseña música?"},
        {"id": "is_gaming", "instructions": "duplicada"},
    ],
    "rationale": "He separado entretenimiento con cupo de lo bloqueado.",
}


def anthropic_body(output: dict[str, Any], stop_reason: str = "end_turn") -> dict[str, Any]:
    return {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "model": "claude-sonnet-5-5",
        "content": [{"type": "text", "text": json.dumps(output, ensure_ascii=False)}],
        "stop_reason": stop_reason,
        "usage": {"input_tokens": 1200, "output_tokens": 400},
    }


async def no_sleep(_: float) -> None:
    return None


@pytest.fixture
def base() -> PolicyContent:
    return load_policy(REPO_ROOT / "policy" / "policy.yaml").content()


@pytest.fixture
async def author() -> Any:
    pricing = load_pricing(REPO_ROOT / "service" / "pricing.yaml")
    async with httpx.AsyncClient() as client:
        yield ClaudeAuthorClient(client, "sk-test", "claude-sonnet-5-5", pricing, sleep=no_sleep)


PREFS = Preferences(
    libre="piano jazz con acordes en pantalla, tutoriales de Azure, Fireship",
    limitado="Atrioc, dunkey, Ludwig… media hora al día",
    no="League of Legends, NBA, Shorts de relleno",
)


@respx.mock
async def test_draft_request_and_parsing(author: ClaudeAuthorClient, base: PolicyContent) -> None:
    route = respx.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(DRAFT_OUTPUT))
    )
    result = await draft_from_preferences(author, PREFS, base)

    request = route.calls.last.request
    assert request.headers["x-api-key"] == "sk-test"
    assert request.headers["anthropic-version"] == ANTHROPIC_VERSION
    body = json.loads(request.content)
    assert body["model"] == "claude-sonnet-5-5"
    assert body["output_config"]["format"]["type"] == "json_schema"
    schema = body["output_config"]["format"]["schema"]
    assert schema["additionalProperties"] is False
    assert schema["properties"]["options"]["required"] == ["NO", "LIMITADO", "LIBRE"]
    assert "ante la duda, LIMITADO" in body["system"]
    assert "media hora al día" in body["messages"][0]["content"][0]["text"]

    content = result.content
    assert content.question.options[Label.LIBRE].description.startswith("Piano jazz")
    assert [a.id for a in content.auxiliary_questions] == ["is_gaming", "is_music_lesson"]
    assert content.channel_lists == base.channel_lists  # se conservan
    assert result.rationale.startswith("He separado")
    assert result.usage.input_tokens == 1200
    assert result.usage.cost_usd == pytest.approx((1200 * 2.0 + 400 * 10.0) / 1e6)


@respx.mock
async def test_refine_sends_false_libre_first(
    author: ClaudeAuthorClient, base: PolicyContent
) -> None:
    output = {**DRAFT_OUTPUT, "changelog": ["NBA pasa a NO explícitamente", " "]}
    route = respx.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(output))
    )
    errors = [
        ErrorExample(video_id="a", truth=Label.LIBRE, predicted=Label.NO, confidence=0.9,
                     summary={"title": "Voicings de jazz"}),
        ErrorExample(video_id="b", truth=Label.NO, predicted=Label.LIBRE, confidence=0.6,
                     summary={"title": "NBA top 10"}),
    ]  # fmt: skip
    snapshot = EvalSnapshot(n=12, accuracy=0.75, false_libre=1)
    result = await refine_with_errors(author, base, errors, snapshot=snapshot, prefs=PREFS)

    text = json.loads(route.calls.last.request.content)["messages"][0]["content"][0]["text"]
    assert text.index("NBA top 10") < text.index("Voicings de jazz")
    assert "1 falsos LIBRE" in text
    assert result.changelog == ["NBA pasa a NO explícitamente"]


@pytest.mark.parametrize("stop_reason", ["refusal", "max_tokens"])
@respx.mock
async def test_refusal_and_truncation_raise(
    author: ClaudeAuthorClient, base: PolicyContent, stop_reason: str
) -> None:
    respx.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=anthropic_body(DRAFT_OUTPUT, stop_reason))
    )
    with pytest.raises(AuthoringError, match=stop_reason):
        await draft_from_preferences(author, PREFS, base)


@respx.mock
async def test_missing_option_raises(author: ClaudeAuthorClient, base: PolicyContent) -> None:
    broken = {**DRAFT_OUTPUT, "options": {"NO": "x", "LIMITADO": "y", "LIBRE": ""}}
    respx.post(ANTHROPIC_URL).mock(return_value=httpx.Response(200, json=anthropic_body(broken)))
    with pytest.raises(AuthoringError):
        await draft_from_preferences(author, PREFS, base)


@respx.mock
async def test_retries_then_gives_up(author: ClaudeAuthorClient, base: PolicyContent) -> None:
    route = respx.post(ANTHROPIC_URL).mock(return_value=httpx.Response(529, text="overloaded"))
    with pytest.raises(RetryableJudgeError):
        await draft_from_preferences(author, PREFS, base)
    assert route.call_count == 3


async def test_empty_preferences_rejected(author: ClaudeAuthorClient, base: PolicyContent) -> None:
    with pytest.raises(ValueError):
        await draft_from_preferences(author, Preferences(), base)


def test_aux_id_slug() -> None:
    assert aux_id("  Is Gaming?  ", 0) == "is_gaming"
    assert aux_id("¿¿", 2) == "aux_3"

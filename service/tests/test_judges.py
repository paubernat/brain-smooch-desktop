"""Contrato de los jueces con respuestas grabadas (derivadas de docs/judges-api-notes.md)."""

import base64
import json
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from PIL import Image

from app.config import REPO_ROOT, Settings
from app.judges.base import JudgeError, RetryableJudgeError, confidence_from_probs
from app.judges.liquid import LIQUID_URL, LiquidJudge
from app.judges.openai_decisions import OPENAI_URL, OpenAIDecisionsJudge
from app.judges.registry import JUDGES, MissingApiKeyError, create_judge
from app.judges.sonnet import ANTHROPIC_URL, SonnetJudge
from app.models import FichaView, ImageRef, Label, VideoSection
from app.policy import Policy, load_policy, parse_policy
from app.pricing import Pricing, load_pricing
from tests.helpers import FIXTURES, POLICY_FIXTURE

JUDGE_FIXTURES = FIXTURES / "judges"
AUX_IDS = ["is_music_education", "is_gaming", "is_sports", "is_low_effort_listicle"]


def recorded(name: str) -> dict[str, Any]:
    return json.loads((JUDGE_FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def policy() -> Policy:
    return load_policy(POLICY_FIXTURE)


@pytest.fixture
def pricing() -> Pricing:
    return load_pricing(REPO_ROOT / "service" / "pricing.yaml")


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    frames = tmp_path / "frames" / "vid"
    frames.mkdir(parents=True)
    Image.new("RGB", (32, 18), (200, 10, 10)).save(frames / "thumbnail.jpg", "JPEG")
    Image.new("RGB", (32, 18), (10, 200, 10)).save(frames / "frame_0.jpg", "JPEG")
    return tmp_path


def view(with_images: bool = True) -> FichaView:
    return FichaView(
        video=VideoSection(title="These Chords So Nasty", channel="Jeff Schneider", is_short=True),
        transcript_excerpt="[00:00] chord voicings",
        transcript_status="ok",
        images=[
            ImageRef(kind="thumbnail", path="frames/vid/thumbnail.jpg"),
            ImageRef(kind="frame", path="frames/vid/frame_0.jpg", t_s=1.0),
            ImageRef(kind="frame", path="frames/vid/missing.jpg", t_s=2.0),
        ]
        if with_images
        else None,
    )


def sent_body(route: respx.Route) -> dict[str, Any]:
    return json.loads(route.calls.last.request.content)


# --- policy / pricing --------------------------------------------------------------------------


def test_policy_version_is_version_plus_hash_and_ignores_line_endings(policy: Policy) -> None:
    assert policy.policy_version.startswith(f"{policy.version}-")
    assert len(policy.policy_version.split("-")[1]) == 8
    text = (POLICY_FIXTURE).read_text(encoding="utf-8")
    crlf = parse_policy(text.replace("\n", "\r\n"))
    assert crlf.policy_version == policy.policy_version
    assert parse_policy(text + "\n# cambio\n").policy_version != policy.policy_version
    assert set(policy.question.options) == set(Label)
    assert [a.id for a in policy.auxiliary_questions] == AUX_IDS


def test_pricing_cost_and_estimate(pricing: Pricing) -> None:
    assert pricing.cost("liquid/d1.2-ultra", 1_000_000) == pytest.approx(0.042)
    assert pricing.cost("openai/decisions", 2000) == pytest.approx(0.0002)
    assert pricing.cost("anthropic/sonnet", 1000, 100) == pytest.approx(0.002 + 0.001)
    assert pricing.estimate_tokens("liquid/d1.2", chars=400, images=2) == 100 + 2 * 1500
    with pytest.raises(KeyError):
        pricing.cost("nope/model", 1)


def test_confidence_from_probs_is_max() -> None:
    assert confidence_from_probs({Label.NO: 0.2, Label.LIBRE: 0.7}) == 0.7
    assert confidence_from_probs({}) == 0.0


def test_registry_requires_keys(pricing: Pricing, tmp_path: Path) -> None:
    settings = Settings(_env_file=None, data_dir=tmp_path)  # type: ignore[call-arg]
    client = httpx.AsyncClient()
    with pytest.raises(MissingApiKeyError):
        create_judge("openai/decisions", client, settings, pricing)
    judge = create_judge("liquid/d1.2", client, settings, pricing, require_key=False)
    assert (judge.name, judge.provider, judge.model) == ("liquid/d1.2", "liquid", "d1.2")
    assert set(JUDGES) == {
        "liquid/d1.2-ultra",
        "liquid/d1.2",
        "openai/decisions",
        "anthropic/sonnet",
    }


# --- Liquid ------------------------------------------------------------------------------------


@respx.mock
async def test_liquid_request_shape_and_parsing(
    policy: Policy, pricing: Pricing, data_dir: Path
) -> None:
    route = respx.post(LIQUID_URL).mock(
        return_value=httpx.Response(200, json=recorded("liquid_response.json"))
    )
    async with httpx.AsyncClient() as client:
        judge = LiquidJudge("d1.2-ultra", client, "liquid_k", pricing, data_dir)
        verdict = await judge.decide(view(), policy)

    request = route.calls.last.request
    assert request.headers["authorization"] == "Bearer liquid_k"
    body = sent_body(route)
    assert body["model"] == "d1.2-ultra"
    assert json.loads(body["state"])["video"]["title"] == "These Chords So Nasty"
    assert "images" not in json.loads(body["state"])
    assert set(body["questions"]) == {"tier", *AUX_IDS}
    tier = body["questions"]["tier"]
    assert tier["type"] == "choice"
    assert set(tier["criteria"]) == {"NO", "LIMITADO", "LIBRE"}
    assert body["questions"]["is_gaming"] == {
        "type": "noul",
        "instructions": policy.auxiliary_questions[1].text,
    }
    assert len(body["images"]) == 2  # el fotograma que falta se omite
    assert body["images"][0].startswith("data:image/jpeg;base64,")
    base64.b64decode(body["images"][0].split(",", 1)[1], validate=True)

    assert verdict.label == Label.LIBRE
    assert verdict.probs == {Label.NO: 0.05, Label.LIMITADO: 0.15, Label.LIBRE: 0.8}
    assert verdict.confidence == 0.62  # Liquid define su propia confianza
    assert verdict.aux["is_music_education"] == 0.95
    assert verdict.input_tokens == 912
    assert verdict.cost_usd == pytest.approx(912 * 0.042 / 1e6)
    assert verdict.raw["model"] == "d1.2-ultra"


@respx.mock
async def test_liquid_without_images_omits_field(
    policy: Policy, pricing: Pricing, data_dir: Path
) -> None:
    route = respx.post(LIQUID_URL).mock(
        return_value=httpx.Response(200, json=recorded("liquid_response.json"))
    )
    async with httpx.AsyncClient() as client:
        await LiquidJudge("d1.2", client, "k", pricing, data_dir).decide(view(False), policy)
    assert "images" not in sent_body(route)
    assert sent_body(route)["model"] == "d1.2"


@respx.mock
@pytest.mark.parametrize(("status", "retryable"), [(429, True), (503, True), (422, False)])
async def test_http_errors_are_classified(
    policy: Policy, pricing: Pricing, data_dir: Path, status: int, retryable: bool
) -> None:
    error = {"error": {"message": "x", "type": "t", "param": None, "code": "c"}}
    respx.post(LIQUID_URL).mock(
        return_value=httpx.Response(status, json=error, headers={"Retry-After": "2"})
    )
    async with httpx.AsyncClient() as client:
        judge = LiquidJudge("d1.2", client, "k", pricing, data_dir)
        with pytest.raises(JudgeError) as info:
            await judge.decide(view(False), policy)
    assert isinstance(info.value, RetryableJudgeError) is retryable
    if retryable:
        assert info.value.retry_after == 2.0  # type: ignore[attr-defined]


# --- OpenAI Decisions --------------------------------------------------------------------------


@respx.mock
async def test_openai_request_shape_and_parsing(
    policy: Policy, pricing: Pricing, data_dir: Path
) -> None:
    route = respx.post(OPENAI_URL).mock(
        return_value=httpx.Response(200, json=recorded("openai_response.json"))
    )
    async with httpx.AsyncClient() as client:
        verdict = await OpenAIDecisionsJudge(client, "sk", pricing, data_dir).decide(view(), policy)

    body = sent_body(route)
    assert body["model"] == "gpt-6-luna"
    [message] = body["input"]
    assert message["role"] == "user"
    assert message["content"][0]["type"] == "input_text"
    assert '"title":"These Chords So Nasty"' in message["content"][0]["text"]
    images = [part for part in message["content"] if part["type"] == "input_image"]
    assert len(images) == 2 and images[0]["image_url"].startswith("data:image/jpeg;base64,")
    assert [q["name"] for q in body["questions"]] == ["tier", *AUX_IDS]
    assert body["questions"][0]["type"] == "choice"
    assert [c["value"] for c in body["questions"][0]["choices"]] == ["NO", "LIMITADO", "LIBRE"]
    assert {q["type"] for q in body["questions"][1:]} == {"predicate"}

    assert verdict.label == Label.LIMITADO
    assert verdict.probs[Label.LIMITADO] == 0.7
    assert verdict.confidence == 0.7  # máx. prob.; la confianza de OpenAI no está definida
    assert verdict.aux["provider_confidence"] == 0.55
    assert verdict.aux["refused"] is False
    assert verdict.aux["refused_questions"] == ["is_sports"]
    assert verdict.aux["is_sports"] is None
    assert verdict.aux["is_gaming"] == 0.9
    assert verdict.input_tokens == 2000
    assert verdict.cost_usd == pytest.approx(2000 * 0.10 / 1e6)


@respx.mock
async def test_openai_refused_main_question_falls_back_to_limitado(
    policy: Policy, pricing: Pricing, data_dir: Path
) -> None:
    respx.post(OPENAI_URL).mock(
        return_value=httpx.Response(200, json=recorded("openai_refusal.json"))
    )
    async with httpx.AsyncClient() as client:
        judge = OpenAIDecisionsJudge(client, "sk", pricing, data_dir)
        verdict = await judge.decide(view(False), policy)
    assert verdict.label == Label.LIMITADO
    assert verdict.confidence == 0.0
    assert verdict.probs == {}
    assert verdict.aux["refused"] is True
    assert verdict.aux["refused_questions"] == ["tier"]
    assert verdict.aux["is_music_education"] == 0.4
    assert verdict.cost_usd == pytest.approx(1500 * 0.10 / 1e6)


def test_openai_unnamed_refusal_matched_by_position(
    policy: Policy, pricing: Pricing, data_dir: Path
) -> None:
    data = recorded("openai_refusal.json")
    data["answers"][0] = {"type": "refusal", "name": None}
    judge = OpenAIDecisionsJudge(httpx.AsyncClient(), "sk", pricing, data_dir)
    verdict = judge.parse_response(data, policy, latency_ms=5)
    assert verdict.aux["refused"] is True and verdict.label == Label.LIMITADO


# --- Anthropic (opcional) ----------------------------------------------------------------------


@respx.mock
async def test_sonnet_request_shape_and_parsing(
    policy: Policy, pricing: Pricing, data_dir: Path
) -> None:
    route = respx.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=recorded("anthropic_response.json"))
    )
    async with httpx.AsyncClient() as client:
        verdict = await SonnetJudge(client, "ak", pricing, data_dir).decide(view(), policy)

    request = route.calls.last.request
    assert request.headers["x-api-key"] == "ak"
    assert request.headers["anthropic-version"] == "2026-10-21"
    body = sent_body(route)
    assert body["model"] == "claude-sonnet-5-5"
    content = body["messages"][0]["content"]
    assert [c["type"] for c in content] == ["image", "image", "text"]  # imágenes antes del texto
    assert content[0]["source"]["type"] == "base64"
    schema = body["output_config"]["format"]["schema"]
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"label", "probs", "reason", *AUX_IDS}

    assert verdict.label == Label.LIBRE  # enum comparado sin distinguir mayúsculas
    assert verdict.confidence == 0.7
    assert verdict.aux["is_music_education"] == 1.0
    assert verdict.cost_usd == pytest.approx((1000 * 2 + 100 * 10) / 1e6)


@respx.mock
async def test_sonnet_refusal(policy: Policy, pricing: Pricing, data_dir: Path) -> None:
    respx.post(ANTHROPIC_URL).mock(
        return_value=httpx.Response(200, json=recorded("anthropic_refusal.json"))
    )
    async with httpx.AsyncClient() as client:
        verdict = await SonnetJudge(client, "ak", pricing, data_dir).decide(view(False), policy)
    assert verdict.label == Label.LIMITADO
    assert verdict.confidence == 0.0
    assert verdict.aux["refused"] is True

"""`blocked_sites`: webs bloqueadas por la extensión (normalización, YAML, guardado, Claude)."""

import shutil
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.authoring.author import content_from_output
from app.policy import PolicyContent, normalize_domain, parse_policy
from app.policy_store import PolicyStore, check_round_trip, render_policy
from tests.helpers import POLICY_FIXTURE


@pytest.fixture
def store(tmp_path: Path) -> PolicyStore:
    path = tmp_path / "policy" / "policy.yaml"
    path.parent.mkdir()
    shutil.copy(POLICY_FIXTURE, path)
    return PolicyStore(path, tmp_path / "policy" / "history")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("reddit.com", "reddit.com"),
        ("  Reddit.COM ", "reddit.com"),
        ("https://www.reddit.com/r/python?x=1", "reddit.com"),
        ("http://user@news.ycombinator.com:8080/", "news.ycombinator.com"),
        ("www.twitch.tv.", "twitch.tv"),
        ("old.reddit.com", "old.reddit.com"),
        ("xn--bcher-kva.example", "xn--bcher-kva.example"),
    ],
)
def test_normalize_domain(raw: str, expected: str) -> None:
    assert normalize_domain(raw) == expected


@pytest.mark.parametrize(
    "raw", ["", "reddit", "127.0.0.1", "foo..com", "-bad.com", "bad-.com", "a b.com", "x.c0m"]
)
def test_normalize_domain_rejects(raw: str) -> None:
    with pytest.raises(ValueError, match="invalid domain"):
        normalize_domain(raw)


def test_model_normalizes_and_dedupes(store: PolicyStore) -> None:
    content = store.load().content()
    data = content.model_dump()
    data["blocked_sites"] = ["https://www.reddit.com/", "reddit.com", "Twitch.tv"]
    assert PolicyContent.model_validate(data).blocked_sites == ["reddit.com", "twitch.tv"]
    data["blocked_sites"] = ["not a domain"]
    with pytest.raises(ValidationError):
        PolicyContent.model_validate(data)


def test_policy_without_blocked_sites_defaults_to_empty(store: PolicyStore) -> None:
    assert "blocked_sites" not in store.raw_text()
    assert store.load().blocked_sites == []


def test_blocked_sites_round_trip_and_save(store: PolicyStore) -> None:
    content = store.load().content()
    content.blocked_sites = ["reddit.com", "twitch.tv"]
    text = render_policy(content, 9)
    assert "blocked_sites: [reddit.com, twitch.tv]" in text
    assert check_round_trip(text, content).blocked_sites == ["reddit.com", "twitch.tv"]

    saved = store.save(content)
    assert saved.blocked_sites == ["reddit.com", "twitch.tv"]
    assert parse_policy(store.raw_text()).content().blocked_sites == ["reddit.com", "twitch.tv"]


def test_claude_output_keeps_blocked_sites(store: PolicyStore) -> None:
    base = store.load().content()
    base.blocked_sites = ["reddit.com"]
    output = {
        "instructions": "Clasifica.",
        "options": {"NO": "a", "LIMITADO": "b", "LIBRE": "c"},
        "auxiliary_questions": [],
        "blocked_sites": [],  # Claude no puede tocar las webs bloqueadas
    }
    assert content_from_output(output, base).blocked_sites == ["reddit.com"]

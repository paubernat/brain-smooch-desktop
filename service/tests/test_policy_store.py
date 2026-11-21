"""Guardado de la política: YAML seguro (`NO`), round-trip, versión e historial."""

import shutil
from pathlib import Path

import pytest

from app.models import Label
from app.policy import PolicyContent, load_policy, parse_policy
from app.policy_store import (
    PolicyConflictError,
    PolicyStore,
    check_round_trip,
    parse_policy_yaml,
    render_policy,
)
from tests.helpers import POLICY_FIXTURE


@pytest.fixture
def store(tmp_path: Path) -> PolicyStore:
    path = tmp_path / "policy" / "policy.yaml"
    path.parent.mkdir()
    shutil.copy(POLICY_FIXTURE, path)
    return PolicyStore(path, tmp_path / "policy" / "history")


def edited(store: PolicyStore, **channels: list[str]) -> PolicyContent:
    content = store.load().content()
    content.question.instructions = "  Nuevas instrucciones.\n"
    content.channel_lists = {Label(k): v for k, v in channels.items()}
    return content


def test_render_quotes_no_and_round_trips(store: PolicyStore) -> None:
    content = edited(store, NO=["no", "Yes", "NBA: highlights"], LIBRE=["Fireship"])
    text = render_policy(content, 7)
    assert '"NO":' in text and "LIBRE:" in text
    parsed = check_round_trip(text, content)
    assert parsed.version == 7
    assert set(parsed.question.options) == set(Label)
    assert parsed.channel_lists[Label.NO] == ["no", "Yes", "NBA: highlights"]
    assert parsed.question.instructions == "Nuevas instrucciones."


def test_round_trip_of_current_policy(store: PolicyStore) -> None:
    content = store.load().content()
    parsed = parse_policy(render_policy(content, 4))
    assert [a.id for a in parsed.auxiliary_questions] == [a.id for a in content.auxiliary_questions]
    for label in Label:
        expected = content.question.options[label].description.strip()
        assert parsed.question.options[label].description == expected


def test_save_bumps_version_and_archives(store: PolicyStore) -> None:
    before = store.load()
    original_text = store.raw_text()
    saved = store.save(edited(store, LIMITADO=["Atrioc"]), expected_version=before.version)

    assert saved.version == before.version + 1
    assert load_policy(store.path).policy_version == saved.policy_version
    archived = store.history_dir / f"v{before.version}.yaml"
    assert archived.read_text(encoding="utf-8") == original_text
    assert [h.version for h in store.history()] == [before.version]

    again = store.save(edited(store))
    assert again.version == before.version + 2
    assert [h.version for h in store.history()] == [before.version + 1, before.version]


def test_candidate_matches_saved_policy_version(store: PolicyStore) -> None:
    content = edited(store, LIBRE=["DeepSeek"])
    candidate = store.candidate(content)
    assert store.save(content).policy_version == candidate.policy_version


def test_save_conflict(store: PolicyStore) -> None:
    with pytest.raises(PolicyConflictError):
        store.save(edited(store), expected_version=999)


def test_parse_yaml_ignores_version_and_validates(store: PolicyStore) -> None:
    content = parse_policy_yaml(store.raw_text())
    assert content.question.id == "tier"
    with pytest.raises(ValueError):
        parse_policy_yaml("version: 1\nquestion: {id: tier}\n")

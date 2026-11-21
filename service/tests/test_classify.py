"""Matriz endurecer / relajar (`app/lock/classify.py`)."""

import pytest

from app.enforcement import EnforcementSettings
from app.live_judge import LiveSettings
from app.lock import classify
from app.lock.password import LockSettings
from app.models import Label
from app.policy import PolicyContent, PolicyOption, load_policy
from app.quota.rules import QuotaSettings
from tests.helpers import POLICY_FIXTURE


@pytest.fixture
def base() -> PolicyContent:
    content = load_policy(POLICY_FIXTURE).content()
    return content.model_copy(
        update={
            "channel_lists": {
                Label.NO: ["BadChannel"],
                Label.LIMITADO: ["Atrioc"],
                Label.LIBRE: ["Fireship"],
            },
            "blocked_sites": ["reddit.com"],
            "rules": content.rules.model_copy(update={"block_live": True}),
        }
    )


def with_lists(content: PolicyContent, **lists: list[str]) -> PolicyContent:
    current = {label.value: list(names) for label, names in content.channel_lists.items()}
    current.update(lists)
    return content.model_copy(update={"channel_lists": {Label(k): v for k, v in current.items()}})


# (descripción, cambio de listas, ¿relaja?)
CHANNEL_CASES = [
    ("NO → LIMITADO", {"NO": [], "LIMITADO": ["Atrioc", "BadChannel"]}, True),
    ("NO → nada", {"NO": []}, True),
    ("LIMITADO → LIBRE", {"LIMITADO": [], "LIBRE": ["Fireship", "Atrioc"]}, True),
    ("LIMITADO → nada", {"LIMITADO": []}, True),
    ("nada → LIBRE", {"LIBRE": ["Fireship", "NewOne"]}, True),
    ("nada → NO", {"NO": ["BadChannel", "NewOne"]}, False),
    ("nada → LIMITADO", {"LIMITADO": ["Atrioc", "NewOne"]}, False),
    ("LIBRE → LIMITADO", {"LIBRE": [], "LIMITADO": ["Atrioc", "Fireship"]}, False),
    ("LIBRE → NO", {"LIBRE": [], "NO": ["BadChannel", "Fireship"]}, False),
    ("LIBRE → nada", {"LIBRE": []}, False),
    ("LIMITADO → NO", {"LIMITADO": [], "NO": ["BadChannel", "Atrioc"]}, False),
    ("mayúsculas", {"NO": ["badchannel"]}, False),
]


@pytest.mark.parametrize(
    ("name", "lists", "relaxes"), CHANNEL_CASES, ids=[c[0] for c in CHANNEL_CASES]
)
def test_channel_moves(base: PolicyContent, name: str, lists: dict, relaxes: bool) -> None:
    out = classify.policy_relaxations(base, with_lists(base, **lists))
    assert bool(out) is relaxes, (name, out)


def test_unchanged_policy_is_not_a_relaxation(base: PolicyContent) -> None:
    assert classify.policy_relaxations(base, base.model_copy(deep=True)) == []


def test_sites_and_rules(base: PolicyContent) -> None:
    more_sites = base.model_copy(update={"blocked_sites": ["reddit.com", "twitch.tv"]})
    assert classify.policy_relaxations(base, more_sites) == []
    assert classify.policy_relaxations(base, base.model_copy(update={"blocked_sites": []})) == [
        "site:reddit.com"
    ]
    rules_off = base.model_copy(
        update={"rules": base.rules.model_copy(update={"block_live": False})}
    )
    assert classify.policy_relaxations(base, rules_off) == ["rule:block_live"]
    rules_on = base.model_copy(
        update={"rules": base.rules.model_copy(update={"block_ai_labeled": True})}
    )
    assert classify.policy_relaxations(base, rules_on) == []


def test_any_text_edit_relaxes(base: PolicyContent) -> None:
    q = base.question
    edited = q.model_copy(update={"instructions": q.instructions + " Sé más estricto."})
    assert classify.policy_relaxations(base, base.model_copy(update={"question": edited})) == [
        "model_text"
    ]
    options = dict(q.options)
    options[Label.NO] = PolicyOption(description="otra cosa")
    changed = base.model_copy(update={"question": q.model_copy(update={"options": options})})
    assert classify.policy_relaxations(base, changed) == ["model_text"]
    no_aux = base.model_copy(update={"auxiliary_questions": []})
    assert classify.policy_relaxations(base, no_aux) == ["model_text"]


def test_settings_matrix() -> None:
    live = LiveSettings()
    assert classify.live_relaxations(live, live.model_copy(update={"min_confidence": 0.9})) == []
    assert classify.live_relaxations(live, live.model_copy(update={"min_confidence": 0.3})) == [
        "live:min_confidence"
    ]
    assert classify.live_relaxations(live, live.model_copy(update={"reveal": "always"})) == []
    assert classify.live_relaxations(live, live.model_copy(update={"config": "A"})) == [
        "live:config"
    ]

    soft = EnforcementSettings(mode="soft")
    assert classify.enforcement_relaxations(EnforcementSettings(), soft) == []
    assert classify.enforcement_relaxations(soft, EnforcementSettings()) == ["enforcement:off"]
    no_shorts = soft.model_copy(update={"block_shorts_feed": False})
    assert classify.enforcement_relaxations(soft, no_shorts) == ["enforcement:shorts_feed"]

    quota = QuotaSettings()
    assert classify.quota_relaxations(quota, QuotaSettings(daily_minutes=10)) == []
    assert classify.quota_relaxations(quota, QuotaSettings(daily_minutes=45)) == ["quota:raise"]

    lock = LockSettings(relax_delay_hours=24)
    assert classify.lock_relaxations(lock, LockSettings(relax_delay_hours=48)) == []
    assert classify.lock_relaxations(lock, LockSettings(relax_delay_hours=0)) == ["lock:delay"]

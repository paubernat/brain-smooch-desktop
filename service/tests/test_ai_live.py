"""Etiqueta IA de YouTube y directos: almacenamiento, migración, FichaView, reglas y política."""

import shutil
import sqlite3
from pathlib import Path
from typing import Any

import pytest

from app import db
from app.authoring.author import content_from_output
from app.config import REPO_ROOT
from app.models import (
    AiDisclosure,
    FichaIn,
    FichaOut,
    InfoLevel,
    Label,
    LiveInfo,
    build_ficha_view,
)
from app.policy import PolicyContent, PolicyRules, parse_policy
from app.policy_store import PolicyStore, check_round_trip, render_policy
from app.rules import apply_rules
from eval.metrics import Record, breakdowns
from tests.helpers import VIDEO_ID, ficha_payload

AI_TEXT = "Sounds or visuals were altered or fully generated. Learn more"


def payload(**metadata: Any) -> FichaIn:
    data = ficha_payload(with_storyboard=False)
    data["metadata"].update(metadata)
    return FichaIn.model_validate(data)


def store_and_load(database: db.Database, ficha: FichaIn) -> FichaOut:
    with database.connect() as conn:
        db.upsert_video(
            conn, ficha, description_clean="", transcript_excerpt="", l2_status="ok",
            l4_status="none",
        )  # fmt: skip
        loaded = db.load_ficha(conn, ficha.video_id)
    assert loaded is not None
    return loaded


@pytest.fixture
def policy() -> PolicyContent:
    return parse_policy((REPO_ROOT / "policy" / "policy.yaml").read_text("utf-8")).content()


# --- almacenamiento ----------------------------------------------------------------------------


def test_disclosure_and_live_round_trip_through_sqlite(database: db.Database) -> None:
    ficha = payload(
        ai_disclosure={"labeled": True, "source": "next", "text": AI_TEXT},
        live={"is_live_now": False, "was_live": True, "is_upcoming": False},
    )
    meta = store_and_load(database, ficha).metadata
    assert meta.ai_disclosure == AiDisclosure(labeled=True, source="next", text=AI_TEXT)
    assert meta.live == LiveInfo(was_live=True)


def test_old_clients_store_unknown(database: db.Database) -> None:
    meta = store_and_load(database, payload()).metadata
    assert meta.ai_disclosure is None and meta.live is None


def test_reposting_updates_the_flags(database: db.Database) -> None:
    store_and_load(database, payload(ai_disclosure={"labeled": True, "source": "reel"}))
    stored = store_and_load(database, payload(ai_disclosure={"labeled": False, "source": "next"}))
    assert stored.metadata.ai_disclosure == AiDisclosure(labeled=False, source="next")


def test_migration_adds_columns_to_existing_db(tmp_path: Path) -> None:
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as conn:  # esquema anterior: sin las columnas nuevas
        conn.execute(
            "CREATE TABLE videos (video_id TEXT PRIMARY KEY, url TEXT, channel_id TEXT, "
            "channel_name TEXT, title TEXT NOT NULL, description_raw TEXT NOT NULL DEFAULT '', "
            "description_clean TEXT NOT NULL DEFAULT '', keywords_json TEXT NOT NULL DEFAULT '[]', "
            "category TEXT, duration_s INTEGER, is_short INTEGER NOT NULL DEFAULT 0, "
            "chapters_json TEXT NOT NULL DEFAULT '[]', publish_date TEXT, is_family_safe INTEGER, "
            "game TEXT, transcript_json TEXT NOT NULL DEFAULT '[]', "
            "transcript_status TEXT NOT NULL DEFAULT 'none', transcript_language TEXT, "
            "transcript_kind TEXT, transcript_excerpt TEXT NOT NULL DEFAULT '', "
            "storyboard_json TEXT, thumbnail_url TEXT, l2_status TEXT NOT NULL DEFAULT 'pending', "
            "l4_status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, "
            "updated_at TEXT NOT NULL)"
        )
        conn.execute(
            "INSERT INTO videos (video_id, title, created_at, updated_at) "
            "VALUES (?, 't', 'x', 'x')",
            (VIDEO_ID,),
        )
    database = db.Database(path)
    database.init()
    with database.connect() as conn:
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(videos)")}
        old = db.load_ficha(conn, VIDEO_ID)
    assert {
        "ai_labeled",
        "ai_disclosure_source",
        "live_now",
        "was_live",
        "live_upcoming",
    } <= columns
    assert old is not None and old.metadata.ai_disclosure is None and old.metadata.live is None
    meta = store_and_load(database, payload(live={"is_live_now": True})).metadata
    assert meta.live == LiveInfo(is_live_now=True)


# --- FichaView (L1) ----------------------------------------------------------------------------


def test_ficha_view_exposes_ai_label_and_live(database: db.Database) -> None:
    ficha = store_and_load(
        database,
        payload(
            ai_disclosure={"labeled": True, "source": "reel", "text": AI_TEXT},
            live={"is_live_now": True},
        ),
    )
    video = build_ficha_view(ficha, {InfoLevel.L1}).to_state()["video"]
    assert video["ai_labeled"] is True
    assert video["live"] == {"is_live_now": True, "was_live": False, "is_upcoming": False}
    assert "ai_labeled" not in build_ficha_view(ficha, {InfoLevel.L3}).to_state()


def test_ficha_view_omits_unknown_and_not_live(database: db.Database) -> None:
    unknown = store_and_load(database, payload(ai_disclosure={"labeled": False}, live={}))
    video = build_ficha_view(unknown, {InfoLevel.L1}).to_state()["video"]
    assert "ai_labeled" not in video and "live" not in video
    checked = store_and_load(database, payload(ai_disclosure={"labeled": False, "source": "next"}))
    assert build_ficha_view(checked, {InfoLevel.L1}).to_state()["video"]["ai_labeled"] is False


# --- reglas fijas ------------------------------------------------------------------------------


def ficha_with(database: db.Database, **metadata: Any) -> FichaOut:
    return store_and_load(database, payload(**metadata))


def test_rules_off_by_default(database: db.Database, policy: PolicyContent) -> None:
    ficha = ficha_with(
        database,
        ai_disclosure={"labeled": True, "source": "next"},
        live={"is_live_now": True},
    )
    assert policy.rules == PolicyRules()
    assert apply_rules(ficha, policy) is None


def test_block_ai_labeled(database: db.Database, policy: PolicyContent) -> None:
    policy.rules.block_ai_labeled = True
    labeled = ficha_with(database, ai_disclosure={"labeled": True, "source": "reel"})
    decision = apply_rules(labeled, policy)
    assert decision is not None and decision.label == Label.NO
    assert decision.rule == "block_ai_labeled"
    clean = ficha_with(database, ai_disclosure={"labeled": False, "source": "next"})
    assert apply_rules(clean, policy) is None


@pytest.mark.parametrize(
    ("live", "blocked"),
    [
        ({"is_live_now": True, "was_live": False}, True),
        ({"is_upcoming": True}, True),
        ({"was_live": True}, False),  # grabación de un directo: decide el modelo
        ({}, False),
    ],
)
def test_block_live(
    database: db.Database, policy: PolicyContent, live: dict[str, bool], blocked: bool
) -> None:
    policy.rules.block_live = True
    decision = apply_rules(ficha_with(database, live=live), policy)
    assert (decision is not None and decision.rule == "block_live") is blocked


def test_blocking_rules_beat_libre_channel(database: db.Database, policy: PolicyContent) -> None:
    policy.channel_lists = {Label.LIBRE: ["jeff schneider"]}
    ficha = ficha_with(database, ai_disclosure={"labeled": True, "source": "next"})
    decision = apply_rules(ficha, policy)
    assert decision is not None and decision.label == Label.LIBRE  # regla IA apagada
    policy.rules.block_ai_labeled = True
    decision = apply_rules(ficha, policy)
    assert decision is not None and decision.label == Label.NO


def test_no_channel_list(database: db.Database, policy: PolicyContent) -> None:
    policy.channel_lists = {Label.NO: ["Jeff Schneider"]}
    decision = apply_rules(ficha_with(database), policy)
    assert decision is not None and (decision.label, decision.rule) == (Label.NO, "channel_list")


# --- política ----------------------------------------------------------------------------------


def test_policy_rules_round_trip(tmp_path: Path, policy: PolicyContent) -> None:
    policy.rules = PolicyRules(block_ai_labeled=True, block_live=False)
    text = render_policy(policy, 9)
    assert "block_ai_labeled: true" in text and "block_live: false" in text
    assert check_round_trip(text, policy).rules == policy.rules

    path = tmp_path / "policy" / "policy.yaml"
    path.parent.mkdir()
    shutil.copy(REPO_ROOT / "policy" / "policy.yaml", path)
    store = PolicyStore(path, tmp_path / "policy" / "history")
    assert store.save(policy).rules.block_ai_labeled is True
    assert store.load().content().rules == policy.rules


def test_policy_without_rules_defaults_to_off() -> None:
    text = (REPO_ROOT / "policy" / "policy.yaml").read_text("utf-8").split("\nrules:")[0]
    assert parse_policy(text).rules == PolicyRules()


def test_claude_output_keeps_rules(policy: PolicyContent) -> None:
    policy.rules = PolicyRules(block_ai_labeled=True, block_live=True)
    output = {
        "instructions": "Clasifica.",
        "options": {"NO": "a", "LIMITADO": "b", "LIBRE": "c"},
        "auxiliary_questions": [],
        "rules": {"block_ai_labeled": False},  # Claude no puede tocar las reglas
    }
    assert content_from_output(output, policy).rules == policy.rules


# --- ablación ----------------------------------------------------------------------------------


def test_ablation_breakdown_by_ai_label_and_live() -> None:
    def rec(truth: Label, pred: Label, **kw: bool) -> Record:
        return Record(
            video_id="v", model_key="m", config="A", truth=truth, pred=pred, confidence=0.9, **kw
        )

    records = [
        rec(Label.NO, Label.LIBRE, ai_labeled=True),
        rec(Label.NO, Label.NO, ai_labeled=True, is_live=True),
        rec(Label.LIBRE, Label.LIBRE),
    ]
    parts = breakdowns(records)
    assert parts["ai_labeled"].n == 2 and parts["not_ai_labeled"].n == 1
    assert parts["ai_labeled"].false_libre_rate == 0.5
    assert parts["live"].n == 1 and parts["not_live"].n == 2

"""Alcance de `policy_version`: solo lo que lee el modelo; listas, webs y reglas no invalidan
la caché de veredictos. Y la migración de las claves antiguas."""

import shutil
from pathlib import Path

from app import db
from app.models import Label
from app.policy import legacy_policy_version, load_policy, model_hash, parse_policy
from app.policy_migration import migrate_verdict_keys
from app.policy_store import PolicyStore
from tests.helpers import POLICY_FIXTURE


def make_store(tmp_path: Path) -> PolicyStore:
    target = tmp_path / "policy" / "policy.yaml"
    target.parent.mkdir(parents=True)
    shutil.copy(POLICY_FIXTURE, target)
    return PolicyStore(target, tmp_path / "policy" / "history")


def test_hash_ignores_lists_sites_and_rules() -> None:
    content = load_policy(POLICY_FIXTURE).content()
    lists = {Label.NO: ["X"], Label.LIMITADO: [], Label.LIBRE: ["Y"]}
    other = content.model_copy(
        update={
            "channel_lists": lists,
            "blocked_sites": ["reddit.com"],
            "rules": content.rules.model_copy(update={"block_live": True}),
        }
    )
    assert model_hash(other) == model_hash(content)
    edited = content.question.model_copy(update={"instructions": "Otra cosa."})
    assert model_hash(content.model_copy(update={"question": edited})) != model_hash(content)
    no_aux = content.model_copy(update={"auxiliary_questions": []})
    assert model_hash(no_aux) != model_hash(content)


def test_saving_lists_keeps_policy_version(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    before = store.load()
    content = before.content()
    lists = {**content.channel_lists, Label.NO: ["SomeChannel"]}
    saved = store.save(
        content.model_copy(update={"channel_lists": lists, "blocked_sites": ["x.com"]})
    )
    assert saved.version == before.version + 1
    assert saved.model_version == before.version  # fichero antiguo: su `version`
    assert saved.policy_version == before.policy_version
    # Un candidato que solo cambia listas también comparte la caché.
    assert store.candidate(saved.content()).policy_version == before.policy_version
    # Cambiar el texto del modelo sí la cambia.
    question = content.question.model_copy(update={"instructions": "Nuevas instrucciones."})
    changed = store.save(saved.content().model_copy(update={"question": question}))
    assert changed.model_version == changed.version
    assert changed.policy_version != before.policy_version
    assert load_policy(store.path).policy_version == changed.policy_version


def test_migration_renames_legacy_cache_keys(tmp_path: Path, database: db.Database) -> None:
    store = make_store(tmp_path)
    text = store.raw_text()
    old_key = legacy_policy_version(text)
    new_key = parse_policy(text).policy_version
    assert old_key != new_key
    with database.connect() as conn:
        conn.execute(
            "INSERT INTO videos (video_id, title, created_at, updated_at) VALUES ('v', 't', '', '')"
        )
        for key in (old_key, "99-deadbeef"):
            conn.execute(
                "INSERT INTO verdicts (video_id, judge, model, config, label, policy_version, "
                "created_at) VALUES ('v', 'j', 'm', 'D', 'LIBRE', ?, '')",
                (key,),
            )
    assert migrate_verdict_keys(database, store.path, store.history_dir) == 1
    assert migrate_verdict_keys(database, store.path, store.history_dir) == 0  # una sola vez
    with database.connect() as conn:
        keys = sorted(r[0] for r in conn.execute("SELECT policy_version FROM verdicts"))
    assert keys == sorted([new_key, "99-deadbeef"])

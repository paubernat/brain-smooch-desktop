from collections import Counter

from app import db
from app.models import FichaIn, Label
from tests.helpers import ficha_payload


def add_videos(database: db.Database, count: int, prefix: str = "v") -> list[str]:
    ids = [f"{prefix}{i:03d}" for i in range(count)]
    with database.connect() as conn:
        for video_id in ids:
            ficha = FichaIn.model_validate(ficha_payload(video_id))
            db.upsert_video(
                conn, ficha, description_clean="", transcript_excerpt="",
                l2_status="pending", l4_status="pending",
            )  # fmt: skip
    return ids


def test_split_is_60_40_per_class(database: db.Database) -> None:
    ids = add_videos(database, 20)
    with database.connect() as conn:
        splits_no = [db.upsert_label(conn, v, Label.NO, None).split for v in ids[:10]]
        splits_libre = [db.upsert_label(conn, v, Label.LIBRE, None).split for v in ids[10:]]
    assert Counter(splits_no) == {"dev": 6, "test": 4}
    assert Counter(splits_libre) == {"dev": 6, "test": 4}


def test_split_is_deterministic(database: db.Database) -> None:
    ids = add_videos(database, 5)
    with database.connect() as conn:
        splits = [db.upsert_label(conn, v, Label.LIMITADO, None).split for v in ids]
    assert splits == ["dev", "dev", "test", "dev", "test"]


def test_relabel_keeps_split_and_updates_label(database: db.Database) -> None:
    ids = add_videos(database, 3)
    with database.connect() as conn:
        for v in ids:
            db.upsert_label(conn, v, Label.NO, None)
        first = db.get_label(conn, ids[2])
        assert first is not None and first.split == "test"
        relabeled = db.upsert_label(conn, ids[2], Label.LIBRE, "changed my mind")
    assert relabeled.split == "test"
    assert relabeled.label is Label.LIBRE
    assert relabeled.reason == "changed my mind"


def test_stats_and_channel_history(database: db.Database) -> None:
    ids = add_videos(database, 4)
    with database.connect() as conn:
        db.upsert_label(conn, ids[0], Label.LIBRE, None)
        db.upsert_label(conn, ids[1], Label.LIBRE, None)
        db.upsert_label(conn, ids[2], Label.NO, None)
        stats = db.label_stats(conn)
        history = db.channel_history(conn, "UCjeffschneider000000000", exclude_video_id=ids[0])
    assert stats.total == 3
    assert stats.by_label == {Label.NO: 1, Label.LIMITADO: 0, Label.LIBRE: 2}
    assert stats.by_split == {"dev": 3, "test": 0}
    assert stats.shorts == 3 and stats.with_transcript == 3
    assert history == {Label.NO: 1, Label.LIMITADO: 0, Label.LIBRE: 1}

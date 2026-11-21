"""SQLite (sqlite3 a pelo) con el esquema de PLAN §7.2 y funciones de repositorio pequeñas."""

import json
import sqlite3
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.models import (
    ChannelInfo,
    FichaIn,
    FichaOut,
    FrameInfo,
    Label,
    LabelInfo,
    LabelOut,
    Levels,
    MetadataOut,
    PendingLabel,
    Split,
    Stats,
    StoryboardIn,
    TranscriptOut,
    Verdict,
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS videos (
    video_id TEXT PRIMARY KEY,
    url TEXT,
    channel_id TEXT,
    channel_name TEXT,
    title TEXT NOT NULL,
    description_raw TEXT NOT NULL DEFAULT '',
    description_clean TEXT NOT NULL DEFAULT '',
    keywords_json TEXT NOT NULL DEFAULT '[]',
    category TEXT,
    duration_s INTEGER,
    is_short INTEGER NOT NULL DEFAULT 0,
    chapters_json TEXT NOT NULL DEFAULT '[]',
    publish_date TEXT,
    is_family_safe INTEGER,
    game TEXT,
    transcript_json TEXT NOT NULL DEFAULT '[]',
    transcript_status TEXT NOT NULL DEFAULT 'none',
    transcript_language TEXT,
    transcript_kind TEXT,
    transcript_excerpt TEXT NOT NULL DEFAULT '',
    storyboard_json TEXT,
    thumbnail_url TEXT,
    l2_status TEXT NOT NULL DEFAULT 'pending',
    l4_status TEXT NOT NULL DEFAULT 'pending',
    l2_attempts INTEGER NOT NULL DEFAULT 0,
    l4_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);

CREATE TABLE IF NOT EXISTS channels (
    channel_id TEXT PRIMARY KEY,
    title TEXT,
    description TEXT NOT NULL DEFAULT '',
    topic_categories_json TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS labels (
    video_id TEXT PRIMARY KEY REFERENCES videos(video_id),
    label TEXT NOT NULL CHECK (label IN ('NO', 'LIMITADO', 'LIBRE')),
    reason TEXT,
    labeled_at TEXT NOT NULL,
    split TEXT NOT NULL CHECK (split IN ('dev', 'test'))
);

CREATE TABLE IF NOT EXISTS verdicts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL REFERENCES videos(video_id),
    judge TEXT NOT NULL,
    model TEXT NOT NULL,
    config TEXT NOT NULL,
    label TEXT NOT NULL,
    probs_json TEXT NOT NULL DEFAULT '{}',
    confidence REAL,
    aux_json TEXT NOT NULL DEFAULT '{}',
    input_tokens INTEGER,
    cost_usd REAL,
    latency_ms INTEGER,
    raw_json TEXT NOT NULL DEFAULT '{}',
    policy_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verdicts_cache
    ON verdicts(video_id, judge, model, config, policy_version);

CREATE TABLE IF NOT EXISTS frames (
    video_id TEXT NOT NULL REFERENCES videos(video_id),
    kind TEXT NOT NULL CHECK (kind IN ('thumbnail', 'frame')),
    idx INTEGER NOT NULL,
    t_s REAL,
    path TEXT NOT NULL,
    PRIMARY KEY (video_id, kind, idx)
);

-- Etiquetas ya incorporadas a la política (recalibración). Una etiqueta está pendiente si no
-- hay fila con su `labeled_at` actual: re-etiquetar un vídeo la vuelve a dejar pendiente.
CREATE TABLE IF NOT EXISTS policy_feedback (
    video_id TEXT PRIMARY KEY REFERENCES videos(video_id),
    labeled_at TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    incorporated_at TEXT NOT NULL
);
"""

# Columnas añadidas después de la primera versión del esquema (migración aditiva).
ADDED_VIDEO_COLUMNS = {
    "l2_attempts": "INTEGER NOT NULL DEFAULT 0",
    "l4_attempts": "INTEGER NOT NULL DEFAULT 0",
}
# Reintentos de enriquecimiento fallido al arrancar (por vídeo y nivel).
MAX_ENRICH_ATTEMPTS = 3

# Patrón de reparto dev/test por clase: d, d, t, d, t → 60/40 exacto cada 5 etiquetas.
SPLIT_PATTERN: tuple[Split, ...] = ("dev", "dev", "test", "dev", "test")


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="microseconds")


class Database:
    """Abre una conexión por operación: válido tanto en el threadpool como en tareas async."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def init(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)
            _add_missing_columns(conn)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


# --- videos -------------------------------------------------------------------------------------


def upsert_video(
    conn: sqlite3.Connection,
    ficha: FichaIn,
    *,
    description_clean: str,
    transcript_excerpt: str,
    l2_status: str,
    l4_status: str,
) -> None:
    meta, transcript, storyboard = ficha.metadata, ficha.transcript, ficha.storyboard
    now = now_iso()
    values: dict[str, Any] = {
        "video_id": ficha.video_id,
        "url": ficha.url,
        "channel_id": meta.channel_id,
        "channel_name": meta.channel_name,
        "title": meta.title,
        "description_raw": meta.description_raw,
        "description_clean": description_clean,
        "keywords_json": _dumps(meta.keywords),
        "category": meta.category,
        "duration_s": meta.duration_s,
        "is_short": int(meta.is_short),
        "chapters_json": _dumps([c.model_dump() for c in meta.chapters]),
        "publish_date": meta.publish_date,
        "is_family_safe": None if meta.is_family_safe is None else int(meta.is_family_safe),
        "game": meta.game,
        "transcript_json": _dumps([s.model_dump() for s in transcript.segments]),
        "transcript_status": transcript.status,
        "transcript_language": transcript.language,
        "transcript_kind": transcript.kind,
        "transcript_excerpt": transcript_excerpt,
        "storyboard_json": storyboard.model_dump_json() if storyboard else None,
        "thumbnail_url": storyboard.thumbnail_url if storyboard else None,
        "l2_status": l2_status,
        "l4_status": l4_status,
        "created_at": now,
        "updated_at": now,
    }
    columns = ", ".join(values)
    placeholders = ", ".join(f":{c}" for c in values)
    updates = ", ".join(f"{c}=excluded.{c}" for c in values if c not in ("video_id", "created_at"))
    conn.execute(
        f"INSERT INTO videos ({columns}) VALUES ({placeholders}) "
        f"ON CONFLICT(video_id) DO UPDATE SET {updates}",
        values,
    )


def get_video_row(conn: sqlite3.Connection, video_id: str) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM videos WHERE video_id = ?", (video_id,)).fetchone()


def get_storyboard(conn: sqlite3.Connection, video_id: str) -> StoryboardIn | None:
    row = conn.execute(
        "SELECT storyboard_json FROM videos WHERE video_id = ?", (video_id,)
    ).fetchone()
    if row is None or row["storyboard_json"] is None:
        return None
    return StoryboardIn.model_validate_json(row["storyboard_json"])


def set_l4_status(conn: sqlite3.Connection, video_id: str, status: str) -> None:
    """Cada "error" cuenta como un intento fallido (ver MAX_ENRICH_ATTEMPTS)."""
    conn.execute(
        "UPDATE videos SET l4_status = ?, updated_at = ?, "
        "l4_attempts = l4_attempts + (? = 'error') WHERE video_id = ?",
        (status, now_iso(), status, video_id),
    )


def set_l2_status_for_channels(
    conn: sqlite3.Connection, channel_ids: Iterable[str], status: str
) -> None:
    now = now_iso()
    conn.executemany(
        "UPDATE videos SET l2_status = ?, updated_at = ?, "
        "l2_attempts = l2_attempts + (? = 'error') WHERE channel_id = ?",
        [(status, now, status, cid) for cid in channel_ids],
    )


def channels_needing_enrichment(
    conn: sqlite3.Connection, include_errors: bool, max_attempts: int = MAX_ENRICH_ATTEMPTS
) -> list[str]:
    """Canales con L2 pendiente y, si `include_errors`, con error y < `max_attempts` fallos."""
    statuses = ("pending", "error") if include_errors else ("pending",)
    rows = conn.execute(
        "SELECT DISTINCT channel_id FROM videos WHERE channel_id IS NOT NULL "
        f"AND l2_status IN ({', '.join('?' * len(statuses))}) AND l2_attempts < ?",
        (*statuses, max_attempts),
    ).fetchall()
    return [r["channel_id"] for r in rows]


# --- channels -----------------------------------------------------------------------------------


def upsert_channel(conn: sqlite3.Connection, channel: ChannelInfo) -> None:
    conn.execute(
        "INSERT INTO channels (channel_id, title, description, topic_categories_json, keywords, "
        "fetched_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(channel_id) DO UPDATE SET "
        "title=excluded.title, description=excluded.description, "
        "topic_categories_json=excluded.topic_categories_json, keywords=excluded.keywords, "
        "fetched_at=excluded.fetched_at",
        (
            channel.channel_id,
            channel.title,
            channel.description,
            _dumps(channel.topics),
            channel.keywords,
            channel.fetched_at or now_iso(),
        ),
    )


def get_channel(conn: sqlite3.Connection, channel_id: str) -> ChannelInfo | None:
    row = conn.execute("SELECT * FROM channels WHERE channel_id = ?", (channel_id,)).fetchone()
    if row is None:
        return None
    return ChannelInfo(
        channel_id=row["channel_id"],
        title=row["title"],
        description=row["description"],
        topics=json.loads(row["topic_categories_json"]),
        keywords=row["keywords"],
        fetched_at=row["fetched_at"],
    )


# --- frames -------------------------------------------------------------------------------------


def replace_frames(conn: sqlite3.Connection, video_id: str, frames: list[FrameInfo]) -> None:
    conn.execute("DELETE FROM frames WHERE video_id = ?", (video_id,))
    conn.executemany(
        "INSERT INTO frames (video_id, kind, idx, t_s, path) VALUES (?, ?, ?, ?, ?)",
        [(video_id, f.kind, f.idx, f.t_s, f.path) for f in frames],
    )


def get_frames(conn: sqlite3.Connection, video_id: str) -> list[FrameInfo]:
    rows = conn.execute(
        "SELECT kind, idx, t_s, path FROM frames WHERE video_id = ? ORDER BY kind = 'frame', idx",
        (video_id,),
    ).fetchall()
    return [FrameInfo(kind=r["kind"], idx=r["idx"], t_s=r["t_s"], path=r["path"]) for r in rows]


# --- labels -------------------------------------------------------------------------------------


def get_label(conn: sqlite3.Connection, video_id: str) -> LabelOut | None:
    row = conn.execute("SELECT * FROM labels WHERE video_id = ?", (video_id,)).fetchone()
    if row is None:
        return None
    return LabelOut(
        video_id=row["video_id"],
        label=row["label"],
        reason=row["reason"],
        split=row["split"],
        labeled_at=row["labeled_at"],
    )


def next_split(conn: sqlite3.Connection, label: Label) -> Split:
    """Split estratificado y determinista: el n-ésimo vídeo de cada clase sigue SPLIT_PATTERN."""
    (count,) = conn.execute(
        "SELECT COUNT(*) FROM labels WHERE label = ?", (label.value,)
    ).fetchone()
    return SPLIT_PATTERN[count % len(SPLIT_PATTERN)]


def upsert_label(
    conn: sqlite3.Connection, video_id: str, label: Label, reason: str | None
) -> LabelOut:
    """Etiqueta (o re-etiqueta) un vídeo. El split se asigna la primera vez y se conserva."""
    existing = get_label(conn, video_id)
    split = existing.split if existing else next_split(conn, label)
    labeled_at = now_iso()
    conn.execute(
        "INSERT INTO labels (video_id, label, reason, labeled_at, split) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(video_id) DO UPDATE SET label=excluded.label, reason=excluded.reason, "
        "labeled_at=excluded.labeled_at",
        (video_id, label.value, reason, labeled_at, split),
    )
    return LabelOut(
        video_id=video_id, label=label, reason=reason, split=split, labeled_at=labeled_at
    )


def channel_history(
    conn: sqlite3.Connection, channel_id: str | None, exclude_video_id: str | None = None
) -> dict[Label, int]:
    """L0: conteo de etiquetas de otros vídeos del mismo canal."""
    history = dict.fromkeys(Label, 0)
    if channel_id is None:
        return history
    rows = conn.execute(
        "SELECT l.label, COUNT(*) AS n FROM labels l JOIN videos v USING (video_id) "
        "WHERE v.channel_id = ? AND v.video_id IS NOT ? GROUP BY l.label",
        (channel_id, exclude_video_id),
    ).fetchall()
    for row in rows:
        history[Label(row["label"])] = row["n"]
    return history


def channel_history_before(
    conn: sqlite3.Connection, channel_id: str | None, labeled_at: str, exclude_video_id: str
) -> dict[Label, int]:
    """L0 con validación temporal (PLAN §10.1): etiquetas del canal anteriores a `labeled_at`."""
    history = dict.fromkeys(Label, 0)
    if channel_id is None:
        return history
    rows = conn.execute(
        "SELECT l.label, COUNT(*) AS n FROM labels l JOIN videos v USING (video_id) "
        "WHERE v.channel_id = ? AND v.video_id != ? AND l.labeled_at < ? GROUP BY l.label",
        (channel_id, exclude_video_id, labeled_at),
    ).fetchall()
    for row in rows:
        history[Label(row["label"])] = row["n"]
    return history


def label_stats(conn: sqlite3.Connection) -> Stats:
    stats = Stats()
    for row in conn.execute("SELECT label, COUNT(*) AS n FROM labels GROUP BY label"):
        stats.by_label[Label(row["label"])] = row["n"]
    for row in conn.execute("SELECT split, COUNT(*) AS n FROM labels GROUP BY split"):
        stats.by_split[row["split"]] = row["n"]
    totals = conn.execute(
        "SELECT COUNT(*) AS total, COALESCE(SUM(v.is_short), 0) AS shorts, "
        "COALESCE(SUM(v.transcript_status = 'ok'), 0) AS with_transcript "
        "FROM labels l JOIN videos v USING (video_id)"
    ).fetchone()
    stats.total = totals["total"]
    stats.shorts = totals["shorts"]
    stats.with_transcript = totals["with_transcript"]
    return stats


# --- feedback para la política (etiquetas pendientes de incorporar) ---------------------------


def pending_labels(conn: sqlite3.Connection) -> list[PendingLabel]:
    """Etiquetas (de ambos splits) que aún no se han incorporado a la política, por antigüedad."""
    rows = conn.execute(
        "SELECT l.video_id, l.label, l.reason, l.split, l.labeled_at, v.title, v.channel_name, "
        "v.is_short FROM labels l JOIN videos v USING (video_id) "
        "LEFT JOIN policy_feedback f ON f.video_id = l.video_id AND f.labeled_at = l.labeled_at "
        "WHERE f.video_id IS NULL ORDER BY l.labeled_at"
    ).fetchall()
    return [
        PendingLabel(
            video_id=r["video_id"],
            title=r["title"],
            channel=r["channel_name"],
            label=r["label"],
            reason=r["reason"],
            split=r["split"],
            is_short=bool(r["is_short"]),
            labeled_at=r["labeled_at"],
        )
        for r in rows
    ]


def mark_labels_incorporated(
    conn: sqlite3.Connection, refs: Iterable[tuple[str, str]], policy_version: int
) -> int:
    """Marca como incorporadas las etiquetas `(video_id, labeled_at)` del split dev.

    Solo cuenta si la etiqueta no ha cambiado desde que se mandó a Claude (mismo `labeled_at`);
    las del split test nunca se marcan (quedan para la ablación final).
    """
    now = now_iso()
    marked = 0
    for video_id, labeled_at in refs:
        cursor = conn.execute(
            "INSERT INTO policy_feedback (video_id, labeled_at, policy_version, incorporated_at) "
            "SELECT video_id, labeled_at, ?, ? FROM labels "
            "WHERE video_id = ? AND labeled_at = ? AND split = 'dev' "
            "ON CONFLICT(video_id) DO UPDATE SET labeled_at=excluded.labeled_at, "
            "policy_version=excluded.policy_version, incorporated_at=excluded.incorporated_at",
            (policy_version, now, video_id, labeled_at),
        )
        marked += cursor.rowcount
    return marked


# --- verdicts (los usarán los jueces y la ablación) ------------------------------------------


def insert_verdict(
    conn: sqlite3.Connection,
    *,
    video_id: str,
    judge: str,
    model: str,
    config: str,
    policy_version: str,
    verdict: Verdict,
) -> int:
    cursor = conn.execute(
        "INSERT INTO verdicts (video_id, judge, model, config, label, probs_json, confidence, "
        "aux_json, input_tokens, cost_usd, latency_ms, raw_json, policy_version, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            video_id,
            judge,
            model,
            config,
            verdict.label.value,
            _dumps(verdict.probs),
            verdict.confidence,
            _dumps(verdict.aux),
            verdict.input_tokens,
            verdict.cost_usd,
            verdict.latency_ms,
            _dumps(verdict.raw),
            policy_version,
            now_iso(),
        ),
    )
    return int(cursor.lastrowid or 0)


def find_verdict(
    conn: sqlite3.Connection,
    *,
    video_id: str,
    judge: str,
    model: str,
    config: str,
    policy_version: str,
) -> Verdict | None:
    """Caché de veredictos por (video_id, judge, model, config, policy_version) — PLAN §10.3."""
    row = conn.execute(
        "SELECT * FROM verdicts WHERE video_id = ? AND judge = ? AND model = ? AND config = ? "
        "AND policy_version = ? ORDER BY id DESC LIMIT 1",
        (video_id, judge, model, config, policy_version),
    ).fetchone()
    if row is None:
        return None
    return Verdict(
        label=row["label"],
        probs=json.loads(row["probs_json"]),
        confidence=row["confidence"] or 0.0,
        aux=json.loads(row["aux_json"]),
        input_tokens=row["input_tokens"] or 0,
        cost_usd=row["cost_usd"] or 0.0,
        latency_ms=row["latency_ms"] or 0,
        raw=json.loads(row["raw_json"]),
    )


# --- ficha completa -----------------------------------------------------------------------------


def load_ficha(conn: sqlite3.Connection, video_id: str) -> FichaOut | None:
    row = get_video_row(conn, video_id)
    if row is None:
        return None
    label = get_label(conn, video_id)
    return FichaOut(
        video_id=row["video_id"],
        url=row["url"],
        levels=Levels(L2=row["l2_status"], L3=row["transcript_status"], L4=row["l4_status"]),
        label=LabelInfo(label=label.label, reason=label.reason, labeled_at=label.labeled_at)
        if label
        else None,
        metadata=_metadata_from_row(row),
        transcript=TranscriptOut(
            status=row["transcript_status"],
            language=row["transcript_language"],
            kind=row["transcript_kind"],
            segment_count=len(json.loads(row["transcript_json"])),
            excerpt=row["transcript_excerpt"],
        ),
        storyboard=StoryboardIn.model_validate_json(row["storyboard_json"])
        if row["storyboard_json"]
        else None,
        channel=get_channel(conn, row["channel_id"]) if row["channel_id"] else None,
        channel_history=channel_history(conn, row["channel_id"], exclude_video_id=video_id),
        frames=get_frames(conn, video_id),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_labeled_video_ids(conn: sqlite3.Connection, split: Split | None = None) -> list[str]:
    query = "SELECT video_id FROM labels"
    params: tuple[str, ...] = ()
    if split is not None:
        query += " WHERE split = ?"
        params = (split,)
    return [r["video_id"] for r in conn.execute(query + " ORDER BY labeled_at", params)]


def _metadata_from_row(row: sqlite3.Row) -> MetadataOut:
    return MetadataOut(
        title=row["title"],
        description_raw=row["description_raw"],
        description_clean=row["description_clean"],
        keywords=json.loads(row["keywords_json"]),
        category=row["category"],
        duration_s=row["duration_s"],
        is_short=bool(row["is_short"]),
        chapters=json.loads(row["chapters_json"]),
        channel_id=row["channel_id"],
        channel_name=row["channel_name"],
        publish_date=row["publish_date"],
        is_family_safe=None if row["is_family_safe"] is None else bool(row["is_family_safe"]),
        game=row["game"],
    )


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def videos_needing_frames(
    conn: sqlite3.Connection, max_attempts: int = MAX_ENRICH_ATTEMPTS
) -> list[str]:
    """Vídeos con L4 pendiente o con error y menos de `max_attempts` fallos."""
    rows = conn.execute(
        "SELECT video_id FROM videos WHERE l4_status IN ('pending', 'error') AND l4_attempts < ?",
        (max_attempts,),
    ).fetchall()
    return [r["video_id"] for r in rows]


def _add_missing_columns(conn: sqlite3.Connection) -> None:
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(videos)")}
    for name, ddl in ADDED_VIDEO_COLUMNS.items():
        if name not in existing:
            conn.execute(f"ALTER TABLE videos ADD COLUMN {name} {ddl}")

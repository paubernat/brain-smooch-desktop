"""Enforcement event log (table `enforce_events`): tampering repaired by the integrity
check (E9), browsers seen or closed by the watcher (E7), layers applied or removed. The
dashboard's "Layers" panel lists the latest ones."""

from typing import Literal

from pydantic import BaseModel

from app import db

EventKind = Literal[
    "tamper",  # a layer differed from what it should be and was restored
    "applied",  # layers (re)applied, e.g. after a policy change
    "removed",  # layers removed (uninstall)
    "browser_seen",  # observe mode: an unmanaged browser is running
    "browser_closed",  # enforce mode: an unmanaged browser was terminated
    "error",  # a layer could not be applied
]
KEEP_EVENTS = 1000


class EnforceEvent(BaseModel):
    id: int
    at: str
    kind: EventKind
    layer: str | None
    detail: str


class EventLog:
    def __init__(self, database: db.Database) -> None:
        self._db = database

    def add(self, kind: EventKind, layer: str | None, detail: str) -> None:
        with self._db.connect() as conn:
            conn.execute(
                "INSERT INTO enforce_events (at, kind, layer, detail) VALUES (?, ?, ?, ?)",
                (db.now_iso(), kind, layer, detail),
            )
            conn.execute(
                "DELETE FROM enforce_events WHERE id <= (SELECT MAX(id) FROM enforce_events) - ?",
                (KEEP_EVENTS,),
            )

    def recent(self, limit: int = 50, kinds: list[EventKind] | None = None) -> list[EnforceEvent]:
        query = "SELECT id, at, kind, layer, detail FROM enforce_events"
        params: list[object] = []
        if kinds:
            query += f" WHERE kind IN ({', '.join('?' for _ in kinds)})"
            params += kinds
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)
        with self._db.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [EnforceEvent.model_validate(dict(row)) for row in rows]

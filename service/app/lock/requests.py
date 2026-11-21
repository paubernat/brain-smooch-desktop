"""Solicitudes de relajación con espera (PLAN-FASE2 §6, opcional; desactivado por defecto).

Con `relax_delay_hours > 0`, un cambio que relaja (y que ya pasó la contraseña) no se aplica
al momento: se guarda aquí y se aplica cuando vence la espera (`app/lock/apply.py`). Se puede
cancelar sin contraseña (cancelar endurece). Tabla `relax_requests`.
"""

import json
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from pydantic import BaseModel

from app import db

RequestKind = Literal["policy", "live", "enforcement", "quota", "lock"]
RequestStatus = Literal["pending", "applied", "cancelled", "conflict"]

Clock = Callable[[], datetime]


def _utc_now() -> datetime:
    return datetime.now(UTC)


class RelaxRequest(BaseModel):
    id: int
    kind: RequestKind
    summary: list[str]
    created_at: str
    apply_after: str
    status: RequestStatus
    resolved_at: str | None = None


class DueRequest(BaseModel):
    request: RelaxRequest
    payload: dict[str, Any]
    base_version: int | None


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat(timespec="seconds")


def _row(row: Any) -> RelaxRequest:
    return RelaxRequest(
        id=row["id"],
        kind=row["kind"],
        summary=json.loads(row["summary_json"]),
        created_at=row["created_at"],
        apply_after=row["apply_after"],
        status=row["status"],
        resolved_at=row["resolved_at"],
    )


class RelaxRequestStore:
    def __init__(self, database: db.Database, clock: Clock = _utc_now) -> None:
        self._db = database
        self._clock = clock

    def create(
        self,
        kind: RequestKind,
        payload: dict[str, Any],
        summary: list[str],
        delay_hours: float,
        base_version: int | None = None,
    ) -> RelaxRequest:
        now = self._clock()
        with self._db.connect() as conn:
            cursor = conn.execute(
                "INSERT INTO relax_requests (kind, payload_json, summary_json, base_version, "
                "created_at, apply_after) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    kind,
                    json.dumps(payload, ensure_ascii=False),
                    json.dumps(summary, ensure_ascii=False),
                    base_version,
                    _iso(now),
                    _iso(now + timedelta(hours=delay_hours)),
                ),
            )
            row = conn.execute(
                "SELECT * FROM relax_requests WHERE id = ?", (cursor.lastrowid,)
            ).fetchone()
        return _row(row)

    def recent(self, limit: int = 20) -> list[RelaxRequest]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM relax_requests ORDER BY id DESC LIMIT ?", (limit,)
            ).fetchall()
        return [_row(r) for r in rows]

    def cancel(self, request_id: int) -> bool:
        return self.resolve(request_id, "cancelled")

    def resolve(self, request_id: int, status: RequestStatus) -> bool:
        with self._db.connect() as conn:
            cursor = conn.execute(
                "UPDATE relax_requests SET status = ?, resolved_at = ? "
                "WHERE id = ? AND status = 'pending'",
                (status, _iso(self._clock()), request_id),
            )
        return cursor.rowcount > 0

    def due(self) -> list[DueRequest]:
        with self._db.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM relax_requests WHERE status = 'pending' AND apply_after <= ? "
                "ORDER BY id",
                (_iso(self._clock()),),
            ).fetchall()
        return [
            DueRequest(
                request=_row(r),
                payload=json.loads(r["payload_json"]),
                base_version=r["base_version"],
            )
            for r in rows
        ]

"""Cupo diario de LIMITADO guardado en SQLite (tablas `quota_days` y `quota_resume`).

El día es el día local del sistema (Europe/Madrid en el PC del usuario): a medianoche
empieza un cupo nuevo. Las reglas están en `rules.py`; aquí solo se leen y guardan.
"""

import sqlite3
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from pydantic import BaseModel

from app import db
from app.quota import rules
from app.quota.rules import DayUsage, QuotaSettings, VideoProgress, VideoQuota
from app.settings_store import load_model, save_model

SETTINGS_KEY = "quota"
# Al retomar un vídeo largo, la posición guardada se da por consumida al pasar de aquí.
RESUME_TOLERANCE_S = 5.0
# Un latido de una pestaña no cuenta más que el tiempo real desde su latido anterior (más
# este margen por el retraso de la red y del navegador).
HEARTBEAT_SLACK_S = 1.0
# Pestañas sin latidos desde hace más de esto se olvidan.
TAB_TTL = timedelta(hours=1)

Clock = Callable[[], datetime]


class QuotaToday(BaseModel):
    """Respuesta de `GET /quota/today` y `POST /quota/heartbeat`."""

    day: str
    daily_s: float
    used_s: float
    remaining_s: float
    exhausted: bool
    grace_video: str | None = None
    video: VideoQuota | None = None


def local_day(now: datetime) -> str:
    return now.date().isoformat()


@dataclass
class _TabBeat:
    """Último latido aceptado de una pestaña (en memoria: un reinicio solo pierde el tope)."""

    at: datetime
    seq: int | None


class HeartbeatGuard:
    """Hace el recuento idempotente por pestaña: descarta latidos repetidos o desordenados
    (`seq` no creciente) y limita cada latido al tiempo real transcurrido desde el anterior
    de esa pestaña, así dos emisores en la misma pestaña no cuentan el doble."""

    def __init__(self) -> None:
        self._tabs: dict[str, _TabBeat] = {}

    def admit(self, now: datetime, tab_id: str | None, seq: int | None, seconds: float) -> float:
        if tab_id is None:
            return seconds  # cliente antiguo: solo el tope de `rules.MAX_HEARTBEAT_S`
        last = self._tabs.get(tab_id)
        if last is not None and seq is not None and last.seq is not None and seq <= last.seq:
            return 0.0
        if last is not None:
            elapsed = max(0.0, (now - last.at).total_seconds())
            seconds = min(seconds, elapsed + HEARTBEAT_SLACK_S)
        self._tabs[tab_id] = _TabBeat(now, seq)
        self._prune(now)
        return seconds

    def _prune(self, now: datetime) -> None:
        stale = [tab for tab, beat in self._tabs.items() if now - beat.at > TAB_TTL]
        for tab in stale:
            del self._tabs[tab]


class QuotaTracker:
    def __init__(self, database: db.Database, clock: Clock = datetime.now) -> None:
        self._db = database
        self._clock = clock
        self._lock = threading.Lock()  # latidos de varias pestañas a la vez
        self._guard = HeartbeatGuard()

    def settings(self) -> QuotaSettings:
        return load_model(self._db, SETTINGS_KEY, QuotaSettings)

    def save_settings(self, value: QuotaSettings) -> QuotaSettings:
        return save_model(self._db, SETTINGS_KEY, value)

    def today(self, video: VideoProgress | None = None) -> QuotaToday:
        day = local_day(self._clock())
        daily_s = self.settings().daily_s
        with self._lock, self._db.connect() as conn:
            usage = _load_usage(conn, day)
            status = None
            if video is not None:
                status = self._finish(
                    conn, day, video, rules.check(usage, daily_s, video), save=False
                )
        return _today(day, daily_s, usage, status)

    def heartbeat(
        self,
        video: VideoProgress,
        seconds: float,
        *,
        tab_id: str | None = None,
        seq: int | None = None,
    ) -> QuotaToday:
        now = self._clock()
        day = local_day(now)
        daily_s = self.settings().daily_s
        with self._lock, self._db.connect() as conn:
            seconds = self._guard.admit(now, tab_id, seq, seconds)
            usage, status = rules.heartbeat(_load_usage(conn, day), daily_s, video, seconds)
            _save_usage(conn, day, usage)
            _consume_resume(conn, day, video)
            status = self._finish(conn, day, video, status, save=True)
        return _today(day, daily_s, usage, status)

    def _finish(
        self,
        conn: sqlite3.Connection,
        day: str,
        video: VideoProgress,
        status: VideoQuota,
        *,
        save: bool,
    ) -> VideoQuota:
        """Vídeo largo cortado: en un latido guarda la posición (consultarlo no la pisa).
        Vídeo permitido con una posición guardada otro día: la ofrece para retomarlo."""
        row = conn.execute(
            "SELECT position_s, saved_day FROM quota_resume WHERE video_id = ?",
            (video.video_id,),
        ).fetchone()
        if status.state == "resume_tomorrow":
            if not save or video.position_s is None:
                return status.model_copy(update={"resume_at_s": row["position_s"] if row else None})
            conn.execute(
                "INSERT INTO quota_resume (video_id, position_s, saved_day) VALUES (?, ?, ?) "
                "ON CONFLICT(video_id) DO UPDATE SET position_s = excluded.position_s, "
                "saved_day = excluded.saved_day",
                (video.video_id, video.position_s, day),
            )
            return status
        if status.allowed and row is not None and row["saved_day"] < day:
            return status.model_copy(update={"resume_at_s": row["position_s"]})
        return status


def _today(day: str, daily_s: float, usage: DayUsage, status: VideoQuota | None) -> QuotaToday:
    left = rules.remaining_s(usage, daily_s)
    return QuotaToday(
        day=day,
        daily_s=daily_s,
        used_s=usage.used_s,
        remaining_s=left,
        exhausted=left <= 0,
        grace_video=usage.grace_video,
        video=status,
    )


def _load_usage(conn: sqlite3.Connection, day: str) -> DayUsage:
    row = conn.execute(
        "SELECT used_s, grace_video, grace_used_s FROM quota_days WHERE day = ?", (day,)
    ).fetchone()
    if row is None:
        return DayUsage()
    return DayUsage(
        used_s=row["used_s"], grace_video=row["grace_video"], grace_used_s=row["grace_used_s"]
    )


def _save_usage(conn: sqlite3.Connection, day: str, usage: DayUsage) -> None:
    conn.execute(
        "INSERT INTO quota_days (day, used_s, grace_video, grace_used_s, updated_at) "
        "VALUES (?, ?, ?, ?, ?) ON CONFLICT(day) DO UPDATE SET used_s = excluded.used_s, "
        "grace_video = excluded.grace_video, grace_used_s = excluded.grace_used_s, "
        "updated_at = excluded.updated_at",
        (day, usage.used_s, usage.grace_video, usage.grace_used_s, db.now_iso()),
    )


def _consume_resume(conn: sqlite3.Connection, day: str, video: VideoProgress) -> None:
    """Un día posterior, ya pasada la posición guardada: se olvida."""
    if video.position_s is None:
        return
    conn.execute(
        "DELETE FROM quota_resume WHERE video_id = ? AND saved_day < ? AND position_s <= ?",
        (video.video_id, day, video.position_s + RESUME_TOLERANCE_S),
    )

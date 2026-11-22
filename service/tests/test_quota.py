"""Cupo diario de LIMITADO: reglas puras, tracker con reloj falso y endpoints."""

from collections.abc import Iterator
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.main import create_app
from app.quota import rules
from app.quota.rules import GRACE_S, MAX_HEARTBEAT_S, DayUsage, VideoProgress
from app.quota.tracker import QuotaTracker

DAILY = 30 * 60.0
SHORT_VIDEO = VideoProgress("short-video", duration_s=600, position_s=100)
LONG_VIDEO = VideoProgress("long-videoo", duration_s=2 * 3600, position_s=1500)


def spend(usage: DayUsage, video: VideoProgress, total: float) -> tuple[DayUsage, rules.VideoQuota]:
    """Latidos de 15 s hasta sumar `total` segundos."""
    status = rules.check(usage, DAILY, video)
    while total > 0:
        step = min(15.0, total)
        usage, status = rules.heartbeat(usage, DAILY, video, step)
        total -= step
    return usage, status


# --- reglas puras --------------------------------------------------------------------------------


def test_within_quota_is_allowed() -> None:
    usage, status = spend(DayUsage(), SHORT_VIDEO, 600)
    assert status.allowed and status.state == "ok"
    assert usage.used_s == 600
    assert rules.remaining_s(usage, DAILY) == DAILY - 600


def test_exhausted_without_grace_when_lots_left() -> None:
    video = VideoProgress("vid-lots-lf", duration_s=40 * 60, position_s=60)
    usage, status = spend(DayUsage(used_s=DAILY - 10), video, 15)
    assert not status.allowed and status.state == "exhausted"
    assert usage.grace_video is None
    assert usage.used_s == DAILY


def test_grace_when_less_than_ten_minutes_left() -> None:
    video = VideoProgress("vid-ending1", duration_s=20 * 60, position_s=15 * 60)
    usage, status = spend(DayUsage(used_s=DAILY - 5), video, 15)
    assert status.allowed and status.state == "grace"
    assert usage.grace_video == video.video_id
    assert usage.grace_used_s == 10  # lo que sobró del latido que agotó el cupo
    assert status.grace_remaining_s == GRACE_S - 10
    # La gracia se gasta y después se bloquea.
    usage, status = spend(usage, video, GRACE_S)
    assert not status.allowed and status.state == "exhausted"


def test_grace_only_for_the_video_playing_when_quota_ran_out() -> None:
    video = VideoProgress("vid-ending1", duration_s=20 * 60, position_s=15 * 60)
    usage, _ = spend(DayUsage(used_s=DAILY - 5), video, 15)
    other = VideoProgress("vid-other01", duration_s=300, position_s=0)
    assert rules.check(usage, DAILY, other).state == "exhausted"
    # Abrir un vídeo casi terminado con el cupo ya agotado no da gracia.
    fresh = DayUsage(used_s=DAILY)
    _, status = rules.heartbeat(fresh, DAILY, other, 15)
    assert status.state == "exhausted"


def test_long_video_saves_position_for_tomorrow() -> None:
    usage, status = spend(DayUsage(used_s=DAILY - 5), LONG_VIDEO, 15)
    assert not status.allowed and status.state == "resume_tomorrow"
    assert status.resume_at_s == LONG_VIDEO.position_s
    assert usage.grace_video is None


def test_long_video_near_the_end_gets_grace_instead() -> None:
    video = VideoProgress("vid-long-en", duration_s=3 * 3600, position_s=3 * 3600 - 120)
    _, status = spend(DayUsage(used_s=DAILY - 5), video, 15)
    assert status.state == "grace"


def test_heartbeat_is_capped_and_never_negative() -> None:
    usage, _ = rules.heartbeat(DayUsage(), DAILY, SHORT_VIDEO, 10_000)
    assert usage.used_s == MAX_HEARTBEAT_S
    usage, _ = rules.heartbeat(usage, DAILY, SHORT_VIDEO, -50)
    assert usage.used_s == MAX_HEARTBEAT_S


def test_zero_quota_blocks_everything() -> None:
    _, status = rules.heartbeat(DayUsage(), 0.0, SHORT_VIDEO, 15)
    assert status.state == "exhausted"


# --- tracker -------------------------------------------------------------------------------------


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 21, 21, 0)

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def tracker(database: db.Database, clock: FakeClock) -> QuotaTracker:
    return QuotaTracker(database, clock=clock)


def beat(tracker: QuotaTracker, video: VideoProgress, total: float) -> rules.VideoQuota | None:
    status = None
    while total > 0:
        step = min(15.0, total)
        status = tracker.heartbeat(video, step).video
        total -= step
    return status


def test_tracker_resets_at_local_midnight(tracker: QuotaTracker, clock: FakeClock) -> None:
    beat(tracker, SHORT_VIDEO, DAILY)
    today = tracker.today()
    assert today.exhausted and today.used_s == DAILY and today.day == "2026-11-21"
    clock.now += timedelta(hours=3)  # 00:00 del día siguiente
    tomorrow = tracker.today()
    assert tomorrow.day == "2026-11-22" and tomorrow.used_s == 0 and not tomorrow.exhausted


def test_tracker_long_video_resumes_next_day(tracker: QuotaTracker, clock: FakeClock) -> None:
    tracker.heartbeat(LONG_VIDEO, 0)
    beat(tracker, VideoProgress("other-video", 600, 0), DAILY - 5)
    status = tracker.heartbeat(LONG_VIDEO, 15).video
    assert status is not None and status.state == "resume_tomorrow"
    # El mismo día: sigue bloqueado y no ofrece retomar.
    same_day = tracker.today(VideoProgress(LONG_VIDEO.video_id, 7200, 0)).video
    assert same_day is not None and not same_day.allowed
    clock.now += timedelta(days=1)
    next_day = tracker.today(VideoProgress(LONG_VIDEO.video_id, 7200, 0)).video
    assert next_day is not None and next_day.allowed
    assert next_day.resume_at_s == LONG_VIDEO.position_s
    # Una vez pasada la posición guardada, se olvida.
    tracker.heartbeat(VideoProgress(LONG_VIDEO.video_id, 7200, 1505), 15)
    later = tracker.today(VideoProgress(LONG_VIDEO.video_id, 7200, 1600)).video
    assert later is not None and later.resume_at_s is None


def test_tracker_uses_configured_quota(tracker: QuotaTracker) -> None:
    tracker.save_settings(rules.QuotaSettings(daily_minutes=1))
    status = beat(tracker, VideoProgress("vid-lots-lf", 3000, 0), 60)
    assert status is not None and status.state == "exhausted"
    assert tracker.today().daily_s == 60


# --- endpoints -----------------------------------------------------------------------------------


@pytest.fixture
def client(policy_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(policy_settings)) as test_client:
        yield test_client


def test_quota_endpoints(client: TestClient) -> None:
    today = client.get("/quota/today").json()
    assert today["daily_s"] == DAILY and today["used_s"] == 0 and today["video"] is None
    body = {"video_id": "abcdefghijk", "seconds": 15, "duration_s": 600, "position_s": 30}
    after = client.post("/quota/heartbeat", json=body).json()
    assert after["used_s"] == 15 and after["video"]["state"] == "ok"
    params = {"video_id": "abcdefghijk", "duration_s": 600, "position_s": 45}
    assert client.get("/quota/today", params=params).json()["video"]["allowed"] is True
    assert client.get("/quota/today", params={"video_id": "bad"}).status_code == 422
    assert client.get("/settings/quota").json() == {"daily_minutes": 30}
    assert client.put("/settings/quota", json={"daily_minutes": 10}).status_code == 200
    assert client.get("/quota/today").json()["daily_s"] == 600


# --- latidos idempotentes por pestaña ------------------------------------------------------------


def test_duplicate_heartbeat_is_ignored(tracker: QuotaTracker, clock: FakeClock) -> None:
    """Un latido reenviado (mismo `seq`) o que llega desordenado no se cuenta dos veces."""
    tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-aaaa1", seq=1)
    clock.now += timedelta(seconds=15)
    tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-aaaa1", seq=2)
    again = tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-aaaa1", seq=2)
    late = tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-aaaa1", seq=1)
    assert again.used_s == 30 and late.used_s == 30


def test_two_senders_in_one_tab_count_wall_time_once(
    tracker: QuotaTracker, clock: FakeClock
) -> None:
    """Dos bucles de latido en la misma pestaña (navegación SPA) declaran 15 s cada 15 s,
    desfasados: el servicio no cuenta más que el tiempo real transcurrido."""
    seq = 0
    for _ in range(4):  # 60 s reales
        for _sender in range(2):
            seq += 1
            tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-bbbb1", seq=seq)
            clock.now += timedelta(seconds=7.5)
    used = tracker.today().used_s
    assert used <= 60 + 15 + 8 * 1.0  # tiempo real + primer latido + margen por latido
    assert used < 2 * 60


def test_heartbeat_capped_to_elapsed_time(tracker: QuotaTracker, clock: FakeClock) -> None:
    tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-cccc1", seq=1)
    clock.now += timedelta(seconds=5)
    after = tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-cccc1", seq=2)
    assert after.used_s == 15 + 5 + 1  # 5 s reales + 1 s de margen


def test_tabs_are_independent_and_legacy_beats_still_count(
    tracker: QuotaTracker, clock: FakeClock
) -> None:
    tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-dddd1", seq=1)
    tracker.heartbeat(SHORT_VIDEO, 15, tab_id="tab-eeee1", seq=1)
    tracker.heartbeat(SHORT_VIDEO, 15)  # cliente sin tab_id
    assert tracker.today().used_s == 45


def test_heartbeat_endpoint_dedupes(client: TestClient) -> None:
    body = {"video_id": "abcdefghijk", "seconds": 15, "tab_id": "tab-ffff1", "seq": 1}
    assert client.post("/quota/heartbeat", json=body).json()["used_s"] == 15
    assert client.post("/quota/heartbeat", json=body).json()["used_s"] == 15
    bad = {**body, "tab_id": "x"}
    assert client.post("/quota/heartbeat", json=bad).status_code == 422

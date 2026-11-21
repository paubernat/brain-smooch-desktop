"""Sesión de administrador de un solo uso (`admin_session_s = 0`)."""

from app.lock.sessions import SINGLE_USE_GRACE_S, SessionManager


def test_zero_ttl_is_single_use_with_grace() -> None:
    now = [1000.0]
    manager = SessionManager(0, clock=lambda: now[0])
    assert manager.single_use and manager.ttl_s == SINGLE_USE_GRACE_S
    session = manager.create()
    assert manager.get(session.token) is not None
    manager.revoke(session.token)
    assert manager.get(session.token) is None


def test_positive_ttl_is_reusable_until_expiry() -> None:
    now = [1000.0]
    manager = SessionManager(600, clock=lambda: now[0])
    assert not manager.single_use
    session = manager.create()
    now[0] += 599
    assert manager.get(session.token) is not None
    now[0] += 2
    assert manager.get(session.token) is None

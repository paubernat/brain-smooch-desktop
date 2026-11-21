"""Candado: contraseña argon2id, sesiones, CSRF, límite de intentos y endpoints protegidos."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import Settings
from app.lock.apply import apply_due
from app.lock.password import PasswordVault
from app.lock.rate_limit import FREE_ATTEMPTS, LoginLimiter, delay_after
from app.lock.requests import RelaxRequestStore
from app.lock.sessions import COOKIE_NAME, CSRF_HEADER, SessionManager
from app.main import create_app
from app.state import AppState

PASSWORD = "correct horse battery"


@pytest.fixture
def client(policy_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(policy_settings)) as test_client:
        yield test_client


def ctx(client: TestClient) -> AppState:
    return client.app.state.ctx  # type: ignore[attr-defined]


def setup_lock(client: TestClient, delay: int = 0) -> str:
    """Crea la contraseña; devuelve el token CSRF de la sesión que abre."""
    body = {
        "custodian": "Ana",
        "password": PASSWORD,
        "password_confirm": PASSWORD,
        "relax_delay_hours": delay,
    }
    res = client.post("/lock/setup", json=body)
    assert res.status_code == 200, res.text
    return res.json()["session"]["csrf"]


def logout(client: TestClient) -> None:
    client.post("/lock/logout")
    client.cookies.clear()


def policy_content(client: TestClient) -> tuple[dict, int]:
    data = client.get("/policy").json()
    return data["content"], data["version"]


def block_site(client: TestClient, site: str = "reddit.com") -> None:
    """Endurecer (sin contraseña): añade una web bloqueada."""
    content, version = policy_content(client)
    content["blocked_sites"] = [*content["blocked_sites"], site]
    res = client.put("/policy", json={"content": content, "expected_version": version})
    assert res.status_code == 200, res.text


# --- piezas sueltas ------------------------------------------------------------------------------


def test_password_hash_is_argon2id_and_verifies(database: db.Database) -> None:
    vault = PasswordVault(database)
    assert not vault.is_set() and not vault.verify("anything")
    vault.set_password(PASSWORD, custodian=" Ana ")
    stored = vault.settings()
    assert stored.password_hash is not None and stored.password_hash.startswith("$argon2id$")
    assert PASSWORD not in stored.password_hash
    assert stored.custodian == "Ana"
    assert vault.verify(PASSWORD) and not vault.verify(PASSWORD + "x")


def test_sessions_expire_and_check_csrf() -> None:
    now = [1000.0]
    sessions = SessionManager(ttl_s=600, clock=lambda: now[0])
    session = sessions.create()
    assert sessions.get(session.token) == session
    assert sessions.get("nope") is None and sessions.get(None) is None
    now[0] += 599
    assert sessions.get(session.token) is not None
    now[0] += 2
    assert sessions.get(session.token) is None


def test_rate_limit_grows(database: db.Database) -> None:
    now = [0.0]
    limiter = LoginLimiter(database, clock=lambda: now[0])
    for _ in range(FREE_ATTEMPTS - 1):
        assert limiter.failure() == 0
    assert limiter.failure() == delay_after(FREE_ATTEMPTS) == 2
    assert limiter.retry_after() == 2
    now[0] += 2
    assert limiter.retry_after() == 0
    assert limiter.failure() == 4  # sigue creciendo
    assert delay_after(100) == 900  # con tope
    limiter.success()
    assert limiter.retry_after() == 0 and limiter.failure() == 0


# --- endpoints -----------------------------------------------------------------------------------


def test_setup_login_logout_flow(client: TestClient) -> None:
    status = client.get("/lock/status").json()
    assert status["password_set"] is False and status["session"] is None
    mismatch = {"custodian": "Ana", "password": PASSWORD, "password_confirm": "other password"}
    assert client.post("/lock/setup", json=mismatch).status_code == 422
    short = {"custodian": "Ana", "password": "short", "password_confirm": "short"}
    assert client.post("/lock/setup", json=short).status_code == 422
    csrf = setup_lock(client)
    assert csrf
    cookie = client.cookies.get(COOKIE_NAME)
    assert cookie
    status = client.get("/lock/status").json()
    assert status["password_set"] and status["custodian"] == "Ana"
    assert "password_hash" not in status and "$argon2" not in str(status)
    assert client.post("/lock/setup", json=mismatch).status_code == 409  # ya existe

    logout(client)
    assert client.get("/lock/status").json()["session"] is None
    assert client.post("/lock/login", json={"password": "wrong"}).status_code == 401
    res = client.post("/lock/login", json={"password": PASSWORD})
    assert res.status_code == 200 and res.json()["session"]["csrf"]
    set_cookie = res.headers["set-cookie"].lower()
    assert "httponly" in set_cookie and "samesite=strict" in set_cookie
    assert "max-age=600" in set_cookie


def test_login_rate_limited(client: TestClient) -> None:
    setup_lock(client)
    logout(client)
    for _ in range(FREE_ATTEMPTS):
        assert client.post("/lock/login", json={"password": "nope"}).status_code == 401
    res = client.post("/lock/login", json={"password": PASSWORD})
    assert res.status_code == 429 and int(res.headers["Retry-After"]) >= 1
    assert client.get("/lock/status").json()["retry_after_s"] > 0


def test_tighten_never_needs_password(client: TestClient) -> None:
    setup_lock(client)
    logout(client)
    content, version = policy_content(client)
    content["blocked_sites"] = [*content["blocked_sites"], "tighten.example"]
    lists = content["channel_lists"]
    lists["NO"] = [*lists["NO"], "NewBadChannel"]
    res = client.put("/policy", json={"content": content, "expected_version": version})
    assert res.status_code == 200, res.text
    assert client.put("/settings/quota", json={"daily_minutes": 20}).status_code == 200
    soft = {"mode": "soft"}
    assert client.put("/settings/enforcement", json=soft).status_code == 200


def test_relax_requires_session_and_csrf(client: TestClient) -> None:
    csrf = setup_lock(client)
    client.put("/settings/enforcement", json={"mode": "soft"})
    block_site(client)
    content, version = policy_content(client)
    relaxed = {**content, "blocked_sites": []}
    body = {"content": relaxed, "expected_version": version}
    # Con sesión pero sin CSRF: 403. Con CSRF: se aplica.
    assert client.put("/policy", json=body).status_code == 403
    headers = {CSRF_HEADER: csrf}
    res = client.put("/policy", json=body, headers=headers)
    assert res.status_code == 200 and res.json()["content"]["blocked_sites"] == []

    logout(client)
    content, version = policy_content(client)
    edited = {**content, "question": {**content["question"], "instructions": "Todo LIBRE."}}
    res = client.put("/policy", json={"content": edited, "expected_version": version})
    assert res.status_code == 401
    same_yaml = {"yaml": client.get("/policy").json()["yaml"]}
    assert client.put("/policy", json=same_yaml).status_code == 200  # mismo contenido: neutro
    assert client.put("/settings/quota", json={"daily_minutes": 90}).status_code == 401
    assert client.put("/settings/enforcement", json={"mode": "off"}).status_code == 401
    live = client.get("/settings/live").json()
    assert client.put("/settings/live", json={**live, "min_confidence": 0.1}).status_code == 401
    assert client.put("/lock/settings", json={"relax_delay_hours": 0}).status_code == 200
    new_password = {"password": "x" * 9, "password_confirm": "x" * 9}
    assert client.post("/lock/password", json=new_password).status_code == 401
    assert client.get("/policy").json()["content"]["question"]["instructions"] != "Todo LIBRE."


def test_without_password_everything_applies(client: TestClient) -> None:
    block_site(client)
    content, _ = policy_content(client)
    res = client.put("/policy", json={"content": {**content, "blocked_sites": []}})
    assert res.status_code == 200
    assert client.put("/settings/quota", json={"daily_minutes": 120}).status_code == 200


def test_password_change_rotates_sessions(client: TestClient) -> None:
    csrf = setup_lock(client)
    new = "another long password"
    body = {"password": new, "password_confirm": new}
    assert client.post("/lock/password", json=body).status_code == 403  # falta CSRF
    res = client.post("/lock/password", json=body, headers={CSRF_HEADER: csrf})
    assert res.status_code == 200
    logout(client)
    assert client.post("/lock/login", json={"password": PASSWORD}).status_code == 401
    assert client.post("/lock/login", json={"password": new}).status_code == 200


def test_delayed_relax_request(client: TestClient) -> None:
    csrf = setup_lock(client, delay=24)
    headers = {CSRF_HEADER: csrf}
    res = client.put("/settings/quota", json={"daily_minutes": 60}, headers=headers)
    assert res.status_code == 202 and res.json()["deferred"] is True
    request = res.json()["request"]
    assert request["kind"] == "quota" and request["summary"] == ["quota:raise"]
    assert client.get("/settings/quota").json()["daily_minutes"] == 30  # aún no
    assert client.get("/lock/requests").json()[0]["status"] == "pending"

    # Vence la espera: se aplica.
    state = ctx(client)
    later = datetime.now(UTC) + timedelta(hours=25)
    state.lock.requests = RelaxRequestStore(state.database, clock=lambda: later)
    assert apply_due(state) == 1
    assert client.get("/settings/quota").json()["daily_minutes"] == 60
    assert state.lock.requests.recent()[0].status == "applied"

    # Cancelar no pide contraseña.
    state.lock.requests = RelaxRequestStore(state.database)
    logout(client)
    client.post("/lock/login", json={"password": PASSWORD})
    csrf = client.get("/lock/status").json()["session"]["csrf"]
    res = client.put("/settings/quota", json={"daily_minutes": 90}, headers={CSRF_HEADER: csrf})
    assert res.status_code == 202
    logout(client)
    request_id = res.json()["request"]["id"]
    assert client.post(f"/lock/requests/{request_id}/cancel").status_code == 200
    assert client.post(f"/lock/requests/{request_id}/cancel").status_code == 404


def test_delayed_policy_request_conflicts_if_policy_changed(client: TestClient) -> None:
    csrf = setup_lock(client, delay=1)
    block_site(client)
    content, version = policy_content(client)
    body = {"content": {**content, "blocked_sites": []}, "expected_version": version}
    assert client.put("/policy", json=body, headers={CSRF_HEADER: csrf}).status_code == 202
    content["blocked_sites"] = [*content["blocked_sites"], "later.example"]
    assert client.put("/policy", json={"content": content}).status_code == 200  # endurecer
    state = ctx(client)
    later = datetime.now(UTC) + timedelta(hours=2)
    state.lock.requests = RelaxRequestStore(state.database, clock=lambda: later)
    assert apply_due(state) == 0
    assert state.lock.requests.recent()[0].status == "conflict"
    assert "later.example" in client.get("/policy").json()["content"]["blocked_sites"]

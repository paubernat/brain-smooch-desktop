"""`/system/*` with a `FakeBackend`, and the installer's dry run (changes nothing)."""

import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import REPO_ROOT, Settings
from app.enforce.fake import FakeBackend
from app.main import create_app
from app.state import AppState

FIREFOX = Path(r"C:\Program Files\Mozilla Firefox")
HOSTS = Path(r"C:\Windows\System32\drivers\etc\hosts")
INSTALLER = REPO_ROOT / "installer" / "install.ps1"
PASSWORD = "correct horse"


@pytest.fixture
def backend() -> FakeBackend:
    fake = FakeBackend()
    fake.add_dir(FIREFOX)
    fake.put_file(HOSTS, "127.0.0.1 localhost\r\n")
    return fake


def client_for(settings: Settings, backend: FakeBackend) -> TestClient:
    settings.firefox_dir = FIREFOX
    settings.hosts_path = HOSTS
    settings.integrity_interval_s = 3600
    return TestClient(create_app(settings, backend=backend))


def set_password(client: TestClient) -> None:
    setup = {"custodian": "Ana", "password": PASSWORD, "password_confirm": PASSWORD}
    assert client.post("/lock/setup", json=setup).status_code == 200
    client.post("/lock/logout")


@pytest.fixture
def prod_nopw_client(policy_settings: Settings, backend: FakeBackend) -> Iterator[TestClient]:
    policy_settings.bs_production = True
    policy_settings.bs_enforce_layers = True
    with client_for(policy_settings, backend) as client:
        yield client


@pytest.fixture
def prod_client(prod_nopw_client: TestClient) -> TestClient:
    set_password(prod_nopw_client)
    return prod_nopw_client


def ctx_of(client: TestClient) -> AppState:
    return client.app.state.ctx  # type: ignore[attr-defined]


def test_layers_status_in_development(policy_settings: Settings, backend: FakeBackend) -> None:
    with client_for(policy_settings, backend) as client:
        body = client.get("/system/layers").json()
        assert body["production"] is False
        assert body["enforcing_layers"] is False
        assert [layer["id"] for layer in body["layers"]] == [f"E{i}" for i in range(1, 10)]
        assert client.post("/system/apply").status_code == 409
    assert backend.writes == 0


def test_apply_and_events_in_production(prod_client: TestClient, backend: FakeBackend) -> None:
    status = prod_client.post("/system/apply").json()
    by_id = {layer["id"]: layer["status"] for layer in status["layers"]}
    assert by_id["E4"] == by_id["E5"] == by_id["E6"] == "ok"
    events = prod_client.get("/system/events").json()
    assert {e["kind"] for e in events} == {"applied"}


def test_policy_change_wakes_layers(prod_client: TestClient, backend: FakeBackend) -> None:
    prod_client.post("/system/apply")
    policy = prod_client.get("/policy").json()
    content = policy["content"] | {"blocked_sites": ["example.org"]}
    assert prod_client.put("/policy", json={"content": content}).status_code == 200
    ctx_of(prod_client).enforce.integrity.run_once()
    assert "0.0.0.0 example.org" in (backend.file_text(HOSTS) or "")


def test_uninstall_requires_admin_session(prod_client: TestClient, backend: FakeBackend) -> None:
    prod_client.post("/system/apply")
    assert prod_client.post("/system/uninstall").status_code == 401
    session = prod_client.post("/lock/login", json={"password": PASSWORD}).json()
    assert prod_client.post("/system/uninstall").status_code == 403  # no CSRF
    res = prod_client.post(
        "/system/uninstall", headers={"X-CSRF-Token": session["session"]["csrf"]}
    )
    assert res.status_code == 200
    assert res.json()["removed"] == ["E6", "E5", "E4"]
    assert backend.file_text(HOSTS) == "127.0.0.1 localhost\r\n"
    assert prod_client.get("/system/layers").json()["suspended"] is True


def test_apply_and_uninstall_need_an_app_password(prod_nopw_client: TestClient) -> None:
    for path in ("/system/apply", "/system/uninstall"):
        res = prod_nopw_client.post(path)
        assert res.status_code == 409
        assert "no app password" in res.json()["detail"]
    assert prod_nopw_client.get("/system/layers").json()["suspended"] is False


@pytest.mark.parametrize(
    "origin", ["https://evil.example", "null", "http://127.0.0.1:9999", "http://localhost.evil"]
)
def test_cross_site_writes_are_refused(prod_client: TestClient, origin: str) -> None:
    prod_client.post("/system/apply")
    session = prod_client.post("/lock/login", json={"password": PASSWORD}).json()
    res = prod_client.post(
        "/system/uninstall",
        headers={"Origin": origin, "X-CSRF-Token": session["session"]["csrf"]},
    )
    assert res.status_code == 403
    assert prod_client.get("/system/layers").json()["suspended"] is False
    # Reads stay open (the extension's GETs carry an Origin too).
    assert prod_client.get("/system/layers", headers={"Origin": origin}).status_code == 200


@pytest.mark.parametrize(
    "origin", [None, "http://127.0.0.1:8765", "http://localhost:8765", "moz-extension://abc"]
)
def test_local_and_extension_writes_are_allowed(
    prod_client: TestClient, origin: str | None
) -> None:
    headers = {"Origin": origin} if origin else {}
    assert prod_client.post("/system/apply", headers=headers).status_code == 200


@pytest.mark.skipif(sys.platform != "win32", reason="Windows PowerShell")
def test_installer_dry_run_changes_nothing() -> None:
    powershell = shutil.which("powershell")
    assert powershell is not None
    result = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
         "-File", str(INSTALLER), "-DryRun"],
        capture_output=True, text=True, timeout=120, check=False,
    )  # fmt: skip
    output = result.stdout + result.stderr
    assert result.returncode == 0, output
    assert "DRY RUN" in output
    for step in ("ProgramData", "WinSW", "BrainSmoochWatchdog", "policies.json", "hosts"):
        assert step in output
    assert "No se ha cambiado nada" in output

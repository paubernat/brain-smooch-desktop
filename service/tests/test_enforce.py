"""Enforcement layers E1-E9 with the in-memory `FakeBackend` (nothing touches the system)."""

import hashlib
import json
from pathlib import Path

import pytest

from app import db
from app.config import Settings
from app.enforce.backend import ProcessInfo, ServiceInfo
from app.enforce.browser_watch import BrowserWatcher, classify
from app.enforce.chromium_policies import (
    CHROME,
    EDGE,
    ChromiumPoliciesLayer,
    blocklist,
    blocklist_values,
)
from app.enforce.events import EventLog
from app.enforce.fake import FakeBackend
from app.enforce.firefox_policies import (
    EXTENSION_ID,
    FirefoxPoliciesLayer,
    XpiStore,
    policies_document,
    xpi_file_url,
)
from app.enforce.hosts import (
    BEGIN,
    END,
    HostsLayer,
    blocked_hosts,
    parse_block,
    render,
    strip_block,
)
from app.enforce.layers import DesiredState, LayerRegistry
from app.enforce.manager import EnforceManager

FIREFOX = Path(r"C:\Program Files\Mozilla Firefox")
HOSTS = Path(r"C:\Windows\System32\drivers\etc\hosts")
EXT_DIR = Path(r"C:\ProgramData\BrainSmooch\extension")
SITES = ("reddit.com", "twitch.tv")
XPI_BYTES = b"PK\x03\x04 signed xpi"
ORIGINAL_HOSTS = "# Copyright (c) Microsoft Corp.\r\n127.0.0.1 localhost\r\n"


@pytest.fixture
def fake() -> FakeBackend:
    backend = FakeBackend()
    backend.add_dir(FIREFOX)
    backend.put_file(HOSTS, ORIGINAL_HOSTS)
    return backend


def install_xpi(backend: FakeBackend) -> XpiStore:
    store = XpiStore(backend, EXT_DIR)
    backend.write_bytes(store.installed, XPI_BYTES)
    backend.write_bytes(store.pristine, XPI_BYTES)
    backend.write_bytes(store.hash_file, hashlib.sha256(XPI_BYTES).hexdigest().encode())
    return store


def desired(store: XpiStore | None = None, sites: tuple[str, ...] = SITES) -> DesiredState:
    return DesiredState(blocked_sites=sites, xpi_url=store.url() if store else None)


# --- hosts (E6) ---------------------------------------------------------------------------


def test_hosts_render_appends_block_and_keeps_crlf() -> None:
    text = render(ORIGINAL_HOSTS, SITES)
    assert text.startswith(ORIGINAL_HOSTS)
    assert "\r\n0.0.0.0 reddit.com\r\n" in text
    assert "\n" not in text.replace("\r\n", "")
    assert blocked_hosts(text) == {"reddit.com", "www.reddit.com", "twitch.tv", "www.twitch.tv"}
    assert parse_block(text) is not None


def test_hosts_render_is_idempotent_and_replaces_old_block() -> None:
    once = render(ORIGINAL_HOSTS, SITES)
    assert render(once, SITES) == once
    fewer = render(once, ("twitch.tv",))
    assert blocked_hosts(fewer) == {"twitch.tv", "www.twitch.tv"}
    assert fewer.count(BEGIN) == 1
    assert strip_block(fewer) == ORIGINAL_HOSTS


def test_hosts_no_trailing_newline_and_lf() -> None:
    text = render("127.0.0.1 localhost", ("reddit.com",))
    assert text.startswith("127.0.0.1 localhost\r\n# BEGIN")
    lf = render("127.0.0.1 localhost\n", ("reddit.com",))
    assert "\r" not in lf


def test_hosts_strip_duplicated_and_unterminated_blocks() -> None:
    block = render("", SITES)
    doubled = ORIGINAL_HOSTS + block + "10.0.0.1 nas\r\n" + block
    assert strip_block(doubled) == ORIGINAL_HOSTS + "10.0.0.1 nas\r\n"
    broken = ORIGINAL_HOSTS + BEGIN + "\r\n0.0.0.0 reddit.com\r\n10.0.0.1 nas\r\n"
    assert strip_block(broken) == ORIGINAL_HOSTS + "10.0.0.1 nas\r\n"
    assert parse_block(broken) is None


def test_hosts_empty_sites_removes_block() -> None:
    assert render(render(ORIGINAL_HOSTS, SITES), ()) == ORIGINAL_HOSTS


def test_hosts_layer_apply_check_remove(fake: FakeBackend) -> None:
    layer = HostsLayer(fake, HOSTS)
    state = desired()
    assert layer.check(state).state == "absent"
    layer.apply(state)
    assert layer.check(state).state == "ok"
    assert fake.dns_flushes == 1
    writes = fake.writes
    layer.apply(state)
    assert fake.writes == writes  # idempotent: nothing to write
    fake.put_file(HOSTS, (fake.file_text(HOSTS) or "").replace("0.0.0.0 reddit.com\r\n", ""))
    assert layer.check(state).state == "drift"
    layer.remove()
    assert fake.file_text(HOSTS) == ORIGINAL_HOSTS
    assert END not in (fake.file_text(HOSTS) or "")


# --- Firefox policies (E4) ----------------------------------------------------------------


def test_firefox_policies_shape_with_xpi(fake: FakeBackend) -> None:
    store = install_xpi(fake)
    doc = policies_document(desired(store))["policies"]
    ext = doc["ExtensionSettings"][EXTENSION_ID]
    assert ext == {
        "installation_mode": "force_installed",
        "install_url": "file:///C:/ProgramData/BrainSmooch/extension/brain-smooch.xpi",
    }
    assert doc["DisablePrivateBrowsing"] is True
    assert doc["DNSOverHTTPS"] == {"Enabled": False, "Locked": True}
    assert doc["BlockAboutConfig"] is True
    assert doc["DisableDeveloperTools"] is True
    assert doc["WebsiteFilter"] == {
        "Block": ["*://*.reddit.com/*", "*://*.twitch.tv/*"],
        "Exceptions": [],
    }


def test_firefox_without_xpi_blocks_youtube() -> None:
    doc = policies_document(DesiredState(blocked_sites=("reddit.com",)))["policies"]
    assert "ExtensionSettings" not in doc
    assert "*://*.youtube.com/*" in doc["WebsiteFilter"]["Block"]


def test_xpi_file_url() -> None:
    assert xpi_file_url(Path(r"C:\A B\x.xpi")) == "file:///C:/A B/x.xpi"


def test_firefox_layer_apply_check_remove_and_backup(fake: FakeBackend) -> None:
    store = install_xpi(fake)
    layer = FirefoxPoliciesLayer(fake, FIREFOX, store)
    foreign = '{"policies": {"DisableTelemetry": true}}'
    fake.put_file(layer.path, foreign)
    state = desired(store)
    assert layer.check(state).state == "drift"
    layer.apply(state)
    assert layer.check(state).state == "ok"
    assert fake.file_text(layer.backup) == foreign
    written = json.loads(fake.file_text(layer.path) or "")
    assert EXTENSION_ID in written["policies"]["ExtensionSettings"]
    writes = fake.writes
    layer.apply(state)
    assert fake.writes == writes
    layer.remove()
    assert fake.file_text(layer.path) == foreign
    assert fake.read_bytes(layer.backup) is None


def test_firefox_layer_restores_tampered_xpi(fake: FakeBackend) -> None:
    store = install_xpi(fake)
    layer = FirefoxPoliciesLayer(fake, FIREFOX, store)
    state = desired(store)
    layer.apply(state)
    fake.write_bytes(store.installed, b"evil")
    assert layer.check(state).state == "drift"
    layer.apply(state)
    assert fake.read_bytes(store.installed) == XPI_BYTES
    assert layer.check(state).state == "ok"


def test_firefox_layer_without_firefox_is_unavailable() -> None:
    backend = FakeBackend()
    layer = FirefoxPoliciesLayer(backend, FIREFOX, XpiStore(backend, EXT_DIR))
    assert layer.check(desired()).state == "unavailable"
    layer.apply(desired())
    assert backend.writes == 0


def test_firefox_layer_remove_without_backup_deletes(fake: FakeBackend) -> None:
    layer = FirefoxPoliciesLayer(fake, FIREFOX, XpiStore(fake, EXT_DIR))
    layer.apply(desired())
    layer.remove()
    assert fake.read_bytes(layer.path) is None


# --- Edge / Chrome (E5) -------------------------------------------------------------------


def test_chromium_blocklist_includes_youtube_and_sites() -> None:
    assert blocklist(("reddit.com", "youtube.com"))[:2] == ["youtube.com", "youtu.be"]
    values = blocklist_values(("reddit.com",))
    assert values["1"] == "youtube.com"
    assert "reddit.com" in values.values()
    assert list(values) == [str(i) for i in range(1, len(values) + 1)]


def test_chromium_layer_apply_check_remove(fake: FakeBackend) -> None:
    fake.set_reg_values(EDGE.key, {"HomepageLocation": "https://example.org"})
    layer = ChromiumPoliciesLayer(fake)
    state = desired()
    assert layer.check(state).state == "drift"  # Edge key exists with foreign values only
    layer.apply(state)
    assert layer.check(state).state == "ok"
    edge = fake.read_reg_values(EDGE.key) or {}
    assert edge["InPrivateModeAvailability"] == 1
    assert edge["DnsOverHttpsMode"] == "off"
    assert edge["BrowserGuestModeEnabled"] == 0
    assert (fake.read_reg_values(CHROME.key) or {})["IncognitoModeAvailability"] == 1
    writes = fake.writes
    layer.apply(state)
    assert fake.writes == writes
    # Removing a site drops the stale numbered entry.
    smaller = desired(sites=("reddit.com",))
    assert layer.check(smaller).state == "drift"
    layer.apply(smaller)
    assert "twitch.tv" not in (fake.read_reg_values(EDGE.blocklist_key) or {}).values()
    layer.remove()
    assert fake.read_reg_values(EDGE.key) == {"HomepageLocation": "https://example.org"}
    assert fake.read_reg_values(EDGE.blocklist_key) is None
    assert fake.read_reg_values(CHROME.key) is None


def test_chromium_layer_absent_when_nothing_written() -> None:
    assert ChromiumPoliciesLayer(FakeBackend()).check(desired()).state == "absent"


# --- browser watch (E7) -------------------------------------------------------------------


@pytest.mark.parametrize(
    ("name", "exe", "blocked"),
    [
        ("chrome.exe", r"C:\Program Files\Google\Chrome\Application\chrome.exe", True),
        ("msedge.exe", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", True),
        ("Opera.exe", r"C:\Users\u\AppData\Local\Programs\Opera GX\opera.exe", True),
        ("brave.exe", None, True),
        ("vivaldi.exe", None, True),
        ("DuckDuckGo.exe", None, True),
        ("Arc.exe", None, True),
        ("waterfox.exe", None, True),
        ("librewolf.exe", None, True),
        ("floorp.exe", None, True),
        ("palemoon.exe", None, True),
        ("Maxthon.exe", None, True),
        ("UCBrowser.exe", None, True),
        ("thorium.exe", None, True),
        ("browser.exe", r"C:\Users\u\AppData\Local\Yandex\YandexBrowser\browser.exe", True),
        ("browser.exe", r"C:\Tools\SomeApp\browser.exe", False),
        ("firefox.exe", r"C:\Program Files\Mozilla Firefox\firefox.exe", False),
        ("FIREFOX.EXE", r"c:\program files\mozilla firefox\FIREFOX.EXE", False),
        ("firefox.exe", r"C:\Users\u\Desktop\Tor Browser\Browser\firefox.exe", True),
        ("firefox.exe", r"C:\Program Files\Mozilla Firefox Portable\firefox.exe", True),
        ("firefox.exe", r"C:\Program Files\Firefox Developer Edition\firefox.exe", True),
        ("firefox.exe", None, False),
        ("msedgewebview2.exe", r"C:\EdgeWebView\Application\msedgewebview2.exe", False),
        ("Code.exe", r"C:\Users\u\AppData\Local\Programs\Microsoft VS Code\Code.exe", False),
        ("Discord.exe", None, False),
        ("explorer.exe", r"C:\Windows\explorer.exe", False),
    ],
)  # fmt: skip
def test_browser_classification(name: str, exe: str | None, blocked: bool) -> None:
    reason = classify(ProcessInfo(1, name, exe), FIREFOX)
    assert (reason is not None) is blocked


@pytest.fixture
def events(database: db.Database) -> EventLog:
    return EventLog(database)


def browsers(backend: FakeBackend) -> None:
    backend.processes = [
        ProcessInfo(10, "chrome.exe", r"C:\Chrome\chrome.exe"),
        ProcessInfo(11, "chrome.exe", r"C:\Chrome\chrome.exe"),
        ProcessInfo(12, "firefox.exe", str(FIREFOX / "firefox.exe")),
        ProcessInfo(13, "msedgewebview2.exe", r"C:\WebView\msedgewebview2.exe"),
    ]


def test_browser_watch_observe_logs_once(fake: FakeBackend, events: EventLog) -> None:
    browsers(fake)
    watcher = BrowserWatcher(fake, events, firefox_dir=FIREFOX, mode="observe")
    assert {h.pid for h in watcher.scan()} == {10, 11}
    assert fake.terminated == []
    assert watcher.scan() == []  # already seen
    logged = events.recent()
    assert len(logged) == 1
    assert logged[0].kind == "browser_seen"
    assert "chrome.exe x2" in logged[0].detail


def test_browser_watch_enforce_terminates(fake: FakeBackend, events: EventLog) -> None:
    browsers(fake)
    watcher = BrowserWatcher(fake, events, firefox_dir=FIREFOX, mode="enforce")
    hits = watcher.scan()
    assert sorted(fake.terminated) == [10, 11]
    assert all(h.terminated for h in hits)
    assert events.recent()[0].kind == "browser_closed"
    assert watcher.scan() == []


def test_browser_watch_off_or_inactive(fake: FakeBackend, events: EventLog) -> None:
    browsers(fake)
    assert BrowserWatcher(fake, events, firefox_dir=FIREFOX, mode="off").scan() == []
    paused = BrowserWatcher(fake, events, firefox_dir=FIREFOX, mode="enforce", active=lambda: False)
    assert paused.scan() == []
    assert fake.terminated == []


# --- registry, integrity (E9) and the manager ---------------------------------------------


@pytest.fixture
def layer_settings(settings: Settings) -> Settings:
    settings.bs_production = True
    settings.bs_enforce_layers = True
    settings.bs_browser_watch = "enforce"
    settings.firefox_dir = FIREFOX
    settings.hosts_path = HOSTS
    settings.program_data_dir = Path(r"C:\ProgramData\BrainSmooch")
    return settings


def make_manager(
    settings: Settings, backend: FakeBackend, database: db.Database, sites: list[str]
) -> EnforceManager:
    return EnforceManager(
        settings,
        backend,
        database,
        blocked_sites=lambda: tuple(sites),
        enforcing=lambda: True,
    )


def test_integrity_applies_then_detects_tamper(
    layer_settings: Settings, fake: FakeBackend, database: db.Database
) -> None:
    install_xpi(fake)
    sites = list(SITES)
    manager = make_manager(layer_settings, fake, database, sites)
    assert manager.integrity.run_once() == []  # first run: applied, not tampering
    assert {e.kind for e in manager.events.recent()} == {"applied"}
    assert manager.integrity.run_once() == []  # nothing changed

    fake.put_file(HOSTS, ORIGINAL_HOSTS)  # someone edits hosts by hand
    fake.delete_reg_key(EDGE.blocklist_key)
    assert manager.integrity.run_once() == ["E5", "E6"]
    tamper = [e for e in manager.events.recent() if e.kind == "tamper"]
    assert {e.layer for e in tamper} == {"E5", "E6"}
    assert blocked_hosts(fake.file_text(HOSTS) or "") >= {"reddit.com"}

    sites.append("x.com")  # a policy change is applied, not reported as tampering
    assert manager.integrity.run_once() == []
    assert "x.com" in blocked_hosts(fake.file_text(HOSTS) or "")


def test_integrity_disabled_never_writes(
    layer_settings: Settings, fake: FakeBackend, database: db.Database
) -> None:
    layer_settings.bs_enforce_layers = False
    manager = make_manager(layer_settings, fake, database, list(SITES))
    writes = fake.writes
    assert manager.integrity.run_once() == []
    assert fake.writes == writes


def test_uninstall_removes_in_reverse_and_suspends(
    layer_settings: Settings, fake: FakeBackend, database: db.Database
) -> None:
    store = install_xpi(fake)
    manager = make_manager(layer_settings, fake, database, list(SITES))
    manager.integrity.run_once()
    assert manager.integrity.suspend_and_remove() == ["E6", "E5", "E4"]
    assert fake.file_text(HOSTS) == ORIGINAL_HOSTS
    assert fake.read_bytes(FIREFOX / "distribution" / "policies.json") is None
    assert fake.read_reg_values(EDGE.key) is None
    assert fake.read_bytes(store.installed) == XPI_BYTES  # the installer removes files
    writes = fake.writes
    assert manager.integrity.run_once() == []
    assert fake.writes == writes
    browsers(fake)
    assert manager.watcher.scan() == []  # watcher paused too
    manager.integrity.rearm()
    assert HostsLayer(fake, HOSTS).check(manager.desired()).state == "ok"


def test_status_report(layer_settings: Settings, fake: FakeBackend, database: db.Database) -> None:
    install_xpi(fake)
    fake.services["BrainSmooch"] = ServiceInfo("running", "automatic", "LocalSystem")
    fake.tasks.add("BrainSmoochWatchdog")
    fake.admins = ["Administrator", "BrainSmoochAdmin"]
    manager = make_manager(layer_settings, fake, database, list(SITES))
    manager.integrity.run_once()
    status = {layer.id: layer.status for layer in manager.status().layers}
    assert status == {f"E{i}": "ok" for i in range(1, 10)}


def test_status_in_development(settings: Settings, database: db.Database) -> None:
    settings.firefox_dir = FIREFOX
    settings.hosts_path = HOSTS
    backend = FakeBackend(admin=False)
    backend.add_dir(FIREFOX)
    manager = EnforceManager(
        settings, backend, database, blocked_sites=lambda: SITES, enforcing=lambda: False
    )
    status = {layer.id: layer.status for layer in manager.status().layers}
    assert status["E4"] == "requires_admin"
    assert status["E6"] == "requires_admin"
    assert status["E7"] == "requires_admin"
    assert status["E8"] == "pending"
    assert status["E9"] == "requires_admin"


def test_registry_orders_layers() -> None:
    backend = FakeBackend()
    registry = LayerRegistry(
        [HostsLayer(backend, HOSTS), ChromiumPoliciesLayer(backend)], installed=True
    )
    assert [layer.id for layer in registry.layers] == ["E5", "E6"]
    assert [layer.id for layer in registry.managed()] == ["E5", "E6"]

"""Wires the enforcement layers together for the service (`AppState.enforce`).

The desired state is read from the current policy (`blocked_sites`) and the installed XPI on
every integrity run, so a policy change is picked up on the next run; the policy routes call
`notify_policy_changed()` to run it right away.
"""

import asyncio
from collections.abc import Callable
from typing import Literal

from pydantic import BaseModel

from app import db
from app.config import BrowserWatchMode, Settings
from app.enforce.backend import LayerBackend
from app.enforce.browser_watch import BrowserWatcher, BrowserWatchLayer
from app.enforce.chromium_policies import ChromiumPoliciesLayer
from app.enforce.events import EventLog
from app.enforce.firefox_policies import FirefoxPoliciesLayer, XpiStore
from app.enforce.hosts import HostsLayer
from app.enforce.integrity import IntegrityLayer, IntegrityMonitor
from app.enforce.layers import (
    AccountsLayer,
    DesiredState,
    FailClosedLayer,
    LayerId,
    LayerRegistry,
    LayerReport,
    ServiceLayer,
    WatchdogLayer,
)


class SystemStatus(BaseModel):
    production: bool
    enforcing_layers: bool  # the service applies and repairs layers
    admin: bool
    suspended: bool
    browser_watch: BrowserWatchMode
    layers: list[LayerReport]


class UninstallResult(BaseModel):
    removed: list[LayerId]
    next_step: Literal["run uninstall.ps1"] = "run uninstall.ps1"


class EnforceManager:
    def __init__(
        self,
        settings: Settings,
        backend: LayerBackend,
        database: db.Database,
        *,
        blocked_sites: Callable[[], tuple[str, ...]],
        enforcing: Callable[[], bool],
    ) -> None:
        self.settings = settings
        self.backend = backend
        self.events = EventLog(database)
        self.xpi = XpiStore(backend, settings.extension_dir)
        self._blocked_sites = blocked_sites
        registry = LayerRegistry(
            [
                AccountsLayer(backend),
                ServiceLayer(backend),
                WatchdogLayer(backend),
                FirefoxPoliciesLayer(backend, settings.firefox_dir, self.xpi),
                ChromiumPoliciesLayer(backend),
                HostsLayer(backend, settings.hosts_path),
                FailClosedLayer(enforcing),
            ],
            installed=settings.bs_production,
        )
        self.integrity = IntegrityMonitor(
            registry,
            self.events,
            database,
            self.desired,
            enabled=settings.enforce_layers,
            interval_s=settings.integrity_interval_s,
        )
        self.watcher = BrowserWatcher(
            backend,
            self.events,
            firefox_dir=settings.firefox_dir,
            mode=settings.bs_browser_watch,
            active=lambda: not self.integrity.state().suspended,
        )
        registry.add(BrowserWatchLayer(self.watcher))
        registry.add(IntegrityLayer(self.integrity))
        self.registry = registry

    def desired(self) -> DesiredState:
        return DesiredState(blocked_sites=self._blocked_sites(), xpi_url=self.xpi.url())

    def status(self) -> SystemStatus:
        return SystemStatus(
            production=self.settings.bs_production,
            enforcing_layers=self.integrity.enabled,
            admin=self.backend.is_admin(),
            suspended=self.integrity.state().suspended,
            browser_watch=self.watcher.mode,
            layers=self.registry.report(self.desired()),
        )

    def notify_policy_changed(self) -> None:
        self.integrity.notify_policy_changed()

    def tasks(self) -> list[asyncio.Task[None]]:
        """Background loops: integrity (production only) and the browser watch (if on)."""
        tasks: list[asyncio.Task[None]] = []
        if self.integrity.enabled:
            tasks.append(asyncio.create_task(self.integrity.run_forever()))
        if self.watcher.mode != "off":
            tasks.append(asyncio.create_task(self._watch_forever()))
        return tasks

    async def _watch_forever(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.watcher.scan)
            except Exception:
                self.watcher.last_scan_ok = False
            await asyncio.sleep(self.settings.browser_watch_interval_s)

"""E9: integrity check. Every minute (and right after a policy change) the service compares
each managed layer (E4 `policies.json` + XPI hash, E5 registry, E6 `hosts`) with what it
should be (sha256 of a canonical form) and restores it if it differs.

- A difference while the desired state is unchanged since the last run is a **tamper**
  event (visible in the dashboard).
- A difference because the policy changed (e.g. a new blocked site) is just `applied`.
- Uninstalling (`/system/uninstall`, admin session) suspends the check and removes the
  layers; it stays suspended across restarts until `/system/apply` or the installer re-arms
  it. The state lives in the `settings` table (key `enforce_layers`).
"""

import asyncio
import contextlib
import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel

from app import db
from app.enforce.events import EventLog
from app.enforce.layers import DesiredState, LayerCheck, LayerId, LayerRegistry
from app.settings_store import load_model, save_model

STATE_KEY = "enforce_layers"
log = logging.getLogger(__name__)


class LayersState(BaseModel):
    suspended: bool = False
    applied: dict[str, Any] | None = None  # DesiredState of the last successful run


def _snapshot(desired: DesiredState) -> dict[str, Any]:
    """JSON form of the desired state, as stored in `settings` (tuples become lists)."""
    return {"blocked_sites": list(desired.blocked_sites), "xpi_url": desired.xpi_url}


class IntegrityMonitor:
    def __init__(
        self,
        registry: LayerRegistry,
        events: EventLog,
        database: db.Database,
        desired: Callable[[], DesiredState],
        *,
        enabled: bool,
        interval_s: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.registry = registry
        self.events = events
        self._db = database
        self._desired = desired
        self.enabled = enabled  # False in development: never writes to the system
        self.interval_s = interval_s
        self._clock = clock
        self._lock = threading.Lock()
        self._wake = asyncio.Event()
        self.last_run: float | None = None

    def state(self) -> LayersState:
        return load_model(self._db, STATE_KEY, LayersState)

    def desired(self) -> DesiredState:
        return self._desired()

    def running(self) -> bool:
        if not self.enabled or self.state().suspended or self.last_run is None:
            return False
        return self._clock() - self.last_run <= 3 * self.interval_s

    def run_once(self) -> list[LayerId]:
        """Checks and restores the managed layers; returns the ones found tampered."""
        if not self.enabled:
            return []
        with self._lock:
            state = self.state()
            if state.suspended:
                return []
            desired = self._desired()
            changed = state.applied != _snapshot(desired)
            tampered: list[LayerId] = []
            for layer in self.registry.managed():
                check = self._check(layer.id, lambda layer=layer: layer.check(desired))
                if check.state in ("ok", "unavailable"):
                    continue
                try:
                    layer.apply(desired)
                except Exception as exc:
                    log.exception("applying %s failed", layer.id)
                    self.events.add("error", layer.id, f"could not apply: {exc}")
                    continue
                if changed:
                    self.events.add("applied", layer.id, check.detail or "applied")
                else:
                    tampered.append(layer.id)
                    self.events.add("tamper", layer.id, f"{check.detail}; restored")
            save_model(
                self._db, STATE_KEY, LayersState(suspended=False, applied=_snapshot(desired))
            )
            self.last_run = self._clock()
            return tampered

    def _check(self, layer_id: LayerId, run: Callable[[], LayerCheck]) -> LayerCheck:
        try:
            return run()
        except Exception as exc:
            return LayerCheck("drift", f"check failed: {exc}")

    def rearm(self) -> list[LayerId]:
        """Hardening (no password): resume after an uninstall and apply now."""
        with self._lock:
            state = self.state()
            save_model(self._db, STATE_KEY, state.model_copy(update={"suspended": False}))
        return self.run_once()

    def suspend_and_remove(self) -> list[LayerId]:
        """Uninstall (the caller checked the admin session): stop repairing, then remove the
        managed layers in reverse order."""
        with self._lock:
            save_model(self._db, STATE_KEY, LayersState(suspended=True, applied=None))
            removed = self.registry.remove_all()
        self.events.add("removed", None, f"layers removed: {', '.join(removed) or 'none'}")
        return removed

    def notify_policy_changed(self) -> None:
        self._wake.set()

    async def run_forever(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self.run_once)
            except Exception:
                log.exception("integrity check failed")
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self._wake.wait(), timeout=self.interval_s)
            self._wake.clear()


class IntegrityLayer:
    id: LayerId = "E9"
    key = "integrity"
    managed = False
    needs_admin = True

    def __init__(self, monitor: IntegrityMonitor) -> None:
        self._monitor = monitor

    def check(self, desired: DesiredState) -> LayerCheck:
        if not self._monitor.enabled:
            return LayerCheck("absent", "only the installed service repairs layers")
        if self._monitor.state().suspended:
            return LayerCheck("drift", "suspended (uninstall in progress)")
        if not self._monitor.running():
            return LayerCheck("drift", "integrity check not running")
        return LayerCheck.ok(f"every {self._monitor.interval_s:.0f} s")

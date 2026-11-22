"""Registry of the enforcement layers E1-E9 (PLAN-FASE2 §4) and their status.

Every layer can `check` itself against the desired state; the *managed* ones (E4 Firefox
policies, E5 Edge/Chrome policies, E6 hosts) can also `apply` and `remove` themselves. The
rest are set up by the installer (E1 accounts, E2 service, E3 watchdog) or are runtime parts
of the service and the extension (E7 browser watch, E8 fail-closed, E9 integrity), so the
service only reports them.

Status shown in the dashboard:
- `ok` (✓): in place and as it should be.
- `missing` (✗): it should be there (installed service) but it is absent or was altered.
- `pending`: not set up yet and nothing elevated is needed (e.g. launch from the web), or it
  is deliberately off (soft install).
- `requires_admin`: not set up yet; the elevated installer does it.
"""

import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from pydantic import BaseModel

from app.enforce.backend import LayerBackend

LayerId = Literal["E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9"]
LayerStatus = Literal["ok", "missing", "pending", "requires_admin"]
CheckState = Literal["ok", "absent", "drift", "unavailable"]

SERVICE_NAME = "BrainSmooch"
WATCHDOG_TASK = "BrainSmoochWatchdog"
ADMIN_ACCOUNT = "BrainSmoochAdmin"


@dataclass(frozen=True)
class DesiredState:
    """What the managed layers must contain: built from the current policy and the XPI."""

    blocked_sites: tuple[str, ...] = ()
    xpi_url: str | None = None  # None: no signed XPI installed -> Firefox blocks YouTube


@dataclass(frozen=True)
class LayerCheck:
    state: CheckState
    detail: str | None = None

    @staticmethod
    def ok(detail: str | None = None) -> "LayerCheck":
        return LayerCheck("ok", detail)


class Layer(Protocol):
    id: LayerId
    key: str
    managed: bool  # the service can apply/remove it
    needs_admin: bool  # setting it up needs the elevated installer (or LocalSystem)

    def check(self, desired: DesiredState) -> LayerCheck: ...


class ManagedLayer(Layer, Protocol):
    def apply(self, desired: DesiredState) -> None: ...
    def remove(self) -> None: ...


class LayerReport(BaseModel):
    id: LayerId
    key: str
    status: LayerStatus
    managed: bool
    detail: str | None = None


def digest(value: Any) -> str:
    """sha256 of a canonical JSON form: the integrity check compares these."""
    text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def status_of(layer: Layer, check: LayerCheck, *, installed: bool) -> LayerStatus:
    match check.state:
        case "ok":
            return "ok"
        case "unavailable":
            return "pending"
        case "drift":
            return "missing"
        case "absent":
            if not layer.needs_admin:
                return "pending"
            return "missing" if installed else "requires_admin"


class LayerRegistry:
    """The layers in order E1..E9. `installed`: running as the installed service."""

    def __init__(self, layers: Sequence[Layer], *, installed: bool) -> None:
        self.layers = sorted(layers, key=lambda layer: layer.id)
        self.installed = installed

    def add(self, layer: Layer) -> None:
        self.layers = sorted([*self.layers, layer], key=lambda item: item.id)

    def managed(self) -> list[ManagedLayer]:
        return [layer for layer in self.layers if _is_managed(layer)]

    def report(self, desired: DesiredState) -> list[LayerReport]:
        out: list[LayerReport] = []
        for layer in self.layers:
            try:
                check = layer.check(desired)
            except Exception as exc:  # a broken probe must not break the panel
                check = LayerCheck("drift", f"check failed: {exc}")
            out.append(
                LayerReport(
                    id=layer.id,
                    key=layer.key,
                    status=status_of(layer, check, installed=self.installed),
                    managed=layer.managed,
                    detail=check.detail,
                )
            )
        return out

    def apply_all(self, desired: DesiredState) -> None:
        for layer in self.managed():
            layer.apply(desired)

    def remove_all(self) -> list[LayerId]:
        """Reverse order (E6, E5, E4); the installer removes E3/E2 and never touches E1."""
        removed: list[LayerId] = []
        for layer in reversed(self.managed()):
            layer.remove()
            removed.append(layer.id)
        return removed


def _is_managed(layer: Layer) -> bool:
    return layer.managed and hasattr(layer, "apply") and hasattr(layer, "remove")


# --- layers set up by the installer (read-only probes) -------------------------------------


class AccountsLayer:
    """E1: an admin account for the custodian (`BrainSmoochAdmin`). Demoting the daily
    account is done by `install.ps1 -Accounts`, after verifying this one."""

    id: LayerId = "E1"
    key = "accounts"
    managed = False
    needs_admin = True

    def __init__(self, backend: LayerBackend, account: str = ADMIN_ACCOUNT) -> None:
        self._backend = backend
        self._account = account

    def check(self, desired: DesiredState) -> LayerCheck:
        admins = self._backend.local_admins()
        if admins is None:
            return LayerCheck("unavailable", "cannot read the Administrators group")
        if self._account.lower() not in {a.lower() for a in admins}:
            return LayerCheck("absent", "run install.ps1 -Accounts")
        others = [a for a in admins if a.lower() not in {self._account.lower(), "administrator"}]
        if others:
            return LayerCheck.ok(f"other admins: {', '.join(others)}")
        return LayerCheck.ok()


class ServiceLayer:
    """E2: Windows service (WinSW) as LocalSystem, automatic start."""

    id: LayerId = "E2"
    key = "service"
    managed = False
    needs_admin = True

    def __init__(self, backend: LayerBackend, name: str = SERVICE_NAME) -> None:
        self._backend = backend
        self._name = name

    def check(self, desired: DesiredState) -> LayerCheck:
        info = self._backend.service_info(self._name)
        if info is None:
            return LayerCheck("absent", "service not installed")
        if info.start_type != "automatic":
            return LayerCheck("drift", f"start type is {info.start_type}")
        if info.status != "running":
            return LayerCheck("drift", f"service is {info.status}")
        return LayerCheck.ok(info.account or None)


class WatchdogLayer:
    """E3: scheduled task as SYSTEM every minute and at logon."""

    id: LayerId = "E3"
    key = "watchdog"
    managed = False
    needs_admin = True

    def __init__(self, backend: LayerBackend, task: str = WATCHDOG_TASK) -> None:
        self._backend = backend
        self._task = task

    def check(self, desired: DesiredState) -> LayerCheck:
        if self._backend.task_exists(self._task):
            return LayerCheck.ok()
        return LayerCheck("absent", "scheduled task not registered")


class FailClosedLayer:
    """E8: the extension blocks YouTube when the service does not answer (`mode: soft`)."""

    id: LayerId = "E8"
    key = "fail_closed"
    managed = False
    needs_admin = False

    def __init__(self, enforcing: Callable[[], bool]) -> None:
        self._enforcing = enforcing

    def check(self, desired: DesiredState) -> LayerCheck:
        if self._enforcing():
            return LayerCheck.ok()
        return LayerCheck("absent", "launch the system from the web")

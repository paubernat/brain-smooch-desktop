"""Everything the enforcement layers touch on Windows goes through `LayerBackend`.

- `WindowsBackend` (`windows_backend.py`): the real one (files, HKLM registry, processes,
  services, scheduled tasks). It only writes when built with `allow_writes=True`, which the
  service does only in production (`BS_PRODUCTION=1`, running as LocalSystem).
- `FakeBackend` (`fake.py`): in memory, used by the tests and never touches the system.

Registry keys are paths relative to `HKEY_LOCAL_MACHINE` (`SOFTWARE\\Policies\\...`).
"""

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

RegValue = int | str  # REG_DWORD or REG_SZ


class WritesDisabledError(PermissionError):
    """The backend is read-only (development): layers are applied only by the installed
    service."""


@dataclass(frozen=True)
class ProcessInfo:
    pid: int
    name: str
    exe: str | None  # full path; None if it cannot be read


@dataclass(frozen=True)
class ServiceInfo:
    status: str  # running | stopped | ...
    start_type: str  # automatic | manual | disabled
    account: str


class LayerBackend(Protocol):
    # --- files ---
    def read_bytes(self, path: Path) -> bytes | None: ...
    def write_bytes(self, path: Path, data: bytes) -> None: ...
    def delete_file(self, path: Path) -> None: ...
    def is_dir(self, path: Path) -> bool: ...

    # --- registry (HKLM) ---
    def read_reg_values(self, key: str) -> dict[str, RegValue] | None: ...
    def set_reg_values(self, key: str, values: Mapping[str, RegValue]) -> None: ...
    def delete_reg_value(self, key: str, name: str) -> None: ...
    def delete_reg_key(self, key: str) -> None: ...

    # --- processes ---
    def list_processes(self) -> list[ProcessInfo]: ...
    def terminate(self, pid: int) -> bool: ...

    # --- read-only probes (E1-E3) ---
    def is_admin(self) -> bool: ...
    def service_info(self, name: str) -> ServiceInfo | None: ...
    def task_exists(self, name: str) -> bool: ...
    def local_admins(self) -> list[str] | None: ...

    def flush_dns(self) -> None: ...

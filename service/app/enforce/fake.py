"""In-memory `LayerBackend` for the tests (and nothing else): never touches the system."""

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

from app.enforce.backend import ProcessInfo, RegValue, ServiceInfo


def _key(path: Path) -> str:
    return str(path).replace("/", "\\").lower()


@dataclass
class FakeBackend:
    files: dict[str, bytes] = field(default_factory=dict)
    dirs: set[str] = field(default_factory=set)
    registry: dict[str, dict[str, RegValue]] = field(default_factory=dict)
    processes: list[ProcessInfo] = field(default_factory=list)
    terminated: list[int] = field(default_factory=list)
    admin: bool = True
    services: dict[str, ServiceInfo] = field(default_factory=dict)
    tasks: set[str] = field(default_factory=set)
    admins: list[str] | None = field(default_factory=list)
    dns_flushes: int = 0
    writes: int = 0

    # --- helpers for tests ---
    def add_dir(self, path: Path) -> None:
        self.dirs.add(_key(path))

    def file_text(self, path: Path) -> str | None:
        data = self.files.get(_key(path))
        return None if data is None else data.decode("utf-8")

    def put_file(self, path: Path, text: str) -> None:
        self.files[_key(path)] = text.encode("utf-8")

    # --- files ---
    def read_bytes(self, path: Path) -> bytes | None:
        return self.files.get(_key(path))

    def write_bytes(self, path: Path, data: bytes) -> None:
        self.writes += 1
        self.files[_key(path)] = data

    def delete_file(self, path: Path) -> None:
        self.writes += 1
        self.files.pop(_key(path), None)

    def is_dir(self, path: Path) -> bool:
        return _key(path) in self.dirs

    # --- registry ---
    def read_reg_values(self, key: str) -> dict[str, RegValue] | None:
        values = self.registry.get(key.lower())
        return None if values is None else dict(values)

    def set_reg_values(self, key: str, values: Mapping[str, RegValue]) -> None:
        self.writes += 1
        self.registry.setdefault(key.lower(), {}).update(values)

    def delete_reg_value(self, key: str, name: str) -> None:
        self.writes += 1
        self.registry.get(key.lower(), {}).pop(name, None)

    def delete_reg_key(self, key: str) -> None:
        self.writes += 1
        self.registry.pop(key.lower(), None)

    # --- processes ---
    def list_processes(self) -> list[ProcessInfo]:
        return [p for p in self.processes if p.pid not in self.terminated]

    def terminate(self, pid: int) -> bool:
        self.terminated.append(pid)
        return True

    # --- probes ---
    def is_admin(self) -> bool:
        return self.admin

    def service_info(self, name: str) -> ServiceInfo | None:
        return self.services.get(name)

    def task_exists(self, name: str) -> bool:
        return name in self.tasks

    def local_admins(self) -> list[str] | None:
        return None if self.admins is None else list(self.admins)

    def flush_dns(self) -> None:
        self.dns_flushes += 1

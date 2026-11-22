"""Real `LayerBackend` for Windows: files, HKLM registry (64-bit view), processes (psutil),
the service (psutil) and the scheduled task (`schtasks /Query`, read-only).

Writes (files, registry, killing processes, flushing DNS) only happen with
`allow_writes=True`; otherwise they raise `WritesDisabledError`. The service enables them only
in production (`Settings.enforce_layers`), where it runs as LocalSystem.
"""

import contextlib
import ctypes
import os
import subprocess
import sys
import tempfile
from collections.abc import Mapping
from pathlib import Path

import psutil

from app.enforce.backend import ProcessInfo, RegValue, ServiceInfo, WritesDisabledError

if sys.platform == "win32":
    import winreg

PROBE_TIMEOUT_S = 15.0
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
ADMINISTRATORS_SID = "S-1-5-32-544"
# Members of the local Administrators group by SID (the group name is localized), via ADSI:
# `Get-LocalGroupMember` fails on orphaned SIDs.
_LIST_ADMINS_PS = (
    "$n=(New-Object Security.Principal.SecurityIdentifier '"
    + ADMINISTRATORS_SID
    + "').Translate([Security.Principal.NTAccount]).Value.Split('\\')[-1];"
    "([ADSI](\"WinNT://./$n,group\")).psbase.Invoke('Members') | "
    "ForEach-Object { $_.GetType().InvokeMember('Name','GetProperty',$null,$_,$null) }"
)


def _run(args: list[str]) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT_S,
            creationflags=_NO_WINDOW,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None


class WindowsBackend:
    def __init__(self, *, allow_writes: bool) -> None:
        self.allow_writes = allow_writes

    def _guard(self, what: str) -> None:
        if not self.allow_writes:
            raise WritesDisabledError(f"{what}: writes are disabled outside production")

    # --- files ---
    def read_bytes(self, path: Path) -> bytes | None:
        try:
            return path.read_bytes()
        except FileNotFoundError:
            return None

    def write_bytes(self, path: Path, data: bytes) -> None:
        self._guard(f"write {path}")
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".bs-", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
            os.replace(tmp, path)
        except BaseException:
            with contextlib.suppress(OSError):
                os.unlink(tmp)
            raise

    def delete_file(self, path: Path) -> None:
        self._guard(f"delete {path}")
        path.unlink(missing_ok=True)

    def is_dir(self, path: Path) -> bool:
        return path.is_dir()

    # --- registry (HKLM, 64-bit view) ---
    def read_reg_values(self, key: str) -> dict[str, RegValue] | None:
        access = winreg.KEY_READ | winreg.KEY_WOW64_64KEY
        try:
            handle = winreg.OpenKeyEx(winreg.HKEY_LOCAL_MACHINE, key, 0, access)
        except FileNotFoundError:
            return None
        values: dict[str, RegValue] = {}
        with handle:
            index = 0
            while True:
                try:
                    name, value, kind = winreg.EnumValue(handle, index)
                except OSError:
                    break
                index += 1
                if kind == winreg.REG_DWORD:
                    values[name] = int(value)
                elif kind in (winreg.REG_SZ, winreg.REG_EXPAND_SZ):
                    values[name] = str(value)
                else:
                    values[name] = repr(value)  # unexpected type: never equal to ours
        return values

    def set_reg_values(self, key: str, values: Mapping[str, RegValue]) -> None:
        self._guard(f"write HKLM\\{key}")
        access = winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY
        with winreg.CreateKeyEx(winreg.HKEY_LOCAL_MACHINE, key, 0, access) as handle:
            for name, value in values.items():
                if isinstance(value, int):
                    winreg.SetValueEx(handle, name, 0, winreg.REG_DWORD, value)
                else:
                    winreg.SetValueEx(handle, name, 0, winreg.REG_SZ, value)

    def delete_reg_value(self, key: str, name: str) -> None:
        self._guard(f"delete HKLM\\{key}\\{name}")
        access = winreg.KEY_SET_VALUE | winreg.KEY_WOW64_64KEY
        try:
            with winreg.OpenKeyEx(winreg.HKEY_LOCAL_MACHINE, key, 0, access) as handle:
                winreg.DeleteValue(handle, name)
        except FileNotFoundError:
            pass

    def delete_reg_key(self, key: str) -> None:
        """Deletes a key without subkeys; a key that still has subkeys (other policies) is
        left in place."""
        self._guard(f"delete HKLM\\{key}")
        access = winreg.KEY_READ | winreg.KEY_WOW64_64KEY
        try:
            with winreg.OpenKeyEx(winreg.HKEY_LOCAL_MACHINE, key, 0, access) as handle:
                subkeys, _, _ = winreg.QueryInfoKey(handle)
            if subkeys:
                return
            winreg.DeleteKeyEx(winreg.HKEY_LOCAL_MACHINE, key, winreg.KEY_WOW64_64KEY, 0)
        except FileNotFoundError:
            pass

    # --- processes ---
    def list_processes(self) -> list[ProcessInfo]:
        out: list[ProcessInfo] = []
        for proc in psutil.process_iter(["pid", "name", "exe"]):
            info = proc.info
            name = info.get("name")
            if not name:
                continue
            out.append(ProcessInfo(pid=int(info["pid"]), name=str(name), exe=info.get("exe")))
        return out

    def terminate(self, pid: int) -> bool:
        self._guard(f"terminate {pid}")
        try:
            psutil.Process(pid).kill()
        except psutil.NoSuchProcess:
            return True
        except psutil.AccessDenied:
            return False
        return True

    # --- probes ---
    def is_admin(self) -> bool:
        try:
            return bool(ctypes.windll.shell32.IsUserAnAdmin())  # type: ignore[attr-defined]
        except (AttributeError, OSError):
            return False

    def service_info(self, name: str) -> ServiceInfo | None:
        try:
            service = psutil.win_service_get(name)  # type: ignore[attr-defined]
            data = service.as_dict()
        except (psutil.NoSuchProcess, AttributeError, OSError):
            return None
        return ServiceInfo(
            status=str(data.get("status", "")),
            start_type=str(data.get("start_type", "")),
            account=str(data.get("username", "")),
        )

    def task_exists(self, name: str) -> bool:
        result = _run(["schtasks", "/Query", "/TN", name])
        return result is not None and result.returncode == 0

    def local_admins(self) -> list[str] | None:
        result = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", _LIST_ADMINS_PS])
        if result is None or result.returncode != 0:
            return None
        return [line.strip() for line in result.stdout.splitlines() if line.strip()]

    def flush_dns(self) -> None:
        self._guard("flush DNS")
        _run(["ipconfig", "/flushdns"])

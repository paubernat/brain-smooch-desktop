"""E7: browser watch. Every few seconds the service lists processes and finds browsers other
than the managed Firefox (the only one with the forced extension):

- every Chromium/Gecko/other browser in `BLOCKED_EXECUTABLES`;
- `firefox.exe` running from anywhere but `C:\\Program Files\\Mozilla Firefox\\` (portable
  Firefox, Tor Browser, Developer Edition...);
- `browser.exe` only under a Yandex folder (the name alone is too generic).

Never touched: WebView2 (`msedgewebview2.exe`, used by Windows and many apps) and Electron
apps (they have their own executable names).

Modes: `observe` only logs (once per process), `enforce` terminates and logs (one event per
browser and scan). Events go to the enforcement log shown in the dashboard.
"""

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PureWindowsPath

from app.config import BrowserWatchMode
from app.enforce.backend import LayerBackend, ProcessInfo
from app.enforce.events import EventLog
from app.enforce.layers import DesiredState, LayerCheck, LayerId

BLOCKED_EXECUTABLES: frozenset[str] = frozenset(
    {
        "chrome.exe",  # Google Chrome, Chromium
        "msedge.exe",  # Microsoft Edge
        "opera.exe",  # Opera, Opera GX
        "brave.exe",
        "vivaldi.exe",
        "duckduckgo.exe",
        "arc.exe",
        "waterfox.exe",
        "librewolf.exe",
        "floorp.exe",
        "palemoon.exe",
        "maxthon.exe",
        "ucbrowser.exe",
        "thorium.exe",
        "mullvadbrowser.exe",
        "seamonkey.exe",
        "iexplore.exe",
    }
)
NEVER_TOUCH: frozenset[str] = frozenset({"msedgewebview2.exe"})
# Generic executable names that are a browser only inside a given folder.
PATH_QUALIFIED: dict[str, str] = {"browser.exe": "yandex"}
FIREFOX_EXECUTABLES: frozenset[str] = frozenset({"firefox.exe", "private_browsing.exe"})


def _under(exe: str, directory: Path) -> bool:
    exe_path = PureWindowsPath(exe.lower())
    root = PureWindowsPath(str(directory).lower())
    return root in exe_path.parents


def classify(proc: ProcessInfo, firefox_dir: Path) -> str | None:
    """Why this process is an unmanaged browser, or None if it may run."""
    name = proc.name.lower()
    if name in NEVER_TOUCH:
        return None
    if name in BLOCKED_EXECUTABLES:
        return f"{proc.name} is not allowed"
    hint = PATH_QUALIFIED.get(name)
    if hint is not None:
        return f"{proc.name} ({hint})" if proc.exe and hint in proc.exe.lower() else None
    if name in FIREFOX_EXECUTABLES:
        if proc.exe is None:
            return None  # unreadable path: do not guess
        if _under(proc.exe, firefox_dir):
            return None
        return f"{proc.name} outside {firefox_dir}"
    return None


@dataclass(frozen=True)
class WatchHit:
    pid: int
    name: str
    exe: str | None
    reason: str
    terminated: bool


class BrowserWatcher:
    def __init__(
        self,
        backend: LayerBackend,
        events: EventLog,
        *,
        firefox_dir: Path,
        mode: BrowserWatchMode,
        active: Callable[[], bool] = lambda: True,
    ) -> None:
        self._backend = backend
        self._events = events
        self._firefox_dir = firefox_dir
        self.mode: BrowserWatchMode = mode
        self._active = active  # False while the layers are suspended (uninstall)
        self._seen: set[int] = set()
        self.last_scan_ok = False

    def scan(self) -> list[WatchHit]:
        if self.mode == "off" or not self._active():
            return []
        hits: list[WatchHit] = []
        alive: set[int] = set()
        for proc in self._backend.list_processes():
            alive.add(proc.pid)
            reason = classify(proc, self._firefox_dir)
            if reason is None:
                continue
            if self.mode == "enforce":
                killed = self._kill(proc.pid)
                if killed or proc.pid not in self._seen:  # a failure is logged once
                    hits.append(WatchHit(proc.pid, proc.name, proc.exe, reason, killed))
            elif proc.pid not in self._seen:
                hits.append(WatchHit(proc.pid, proc.name, proc.exe, reason, False))
            self._seen.add(proc.pid)
        self._seen &= alive
        self._log(hits)
        self.last_scan_ok = True
        return hits

    def _kill(self, pid: int) -> bool:
        try:
            return self._backend.terminate(pid)
        except PermissionError:
            return False

    def _log(self, hits: list[WatchHit]) -> None:
        """One event per (browser, path, outcome) and scan: Chrome alone runs ~10 processes."""
        groups = Counter((h.name, h.exe, h.reason, h.terminated) for h in hits)
        for (name, exe, reason, terminated), count in groups.items():
            where = f" [{exe}]" if exe else ""
            kind = "browser_closed" if terminated else "browser_seen"
            if self.mode == "enforce" and not terminated:
                reason += " (could not terminate)"
            self._events.add(kind, "E7", f"{name} x{count}: {reason}{where}")


class BrowserWatchLayer:
    id: LayerId = "E7"
    key = "browser_watch"
    managed = False
    needs_admin = True

    def __init__(self, watcher: BrowserWatcher) -> None:
        self._watcher = watcher

    def check(self, desired: DesiredState) -> LayerCheck:
        match self._watcher.mode:
            case "enforce":
                return LayerCheck.ok("enforce")
            case "observe":
                return LayerCheck("unavailable", "observe only (soft install)")
            case "off":
                return LayerCheck("absent", "off")

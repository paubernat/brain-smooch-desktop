"""E4: Firefox enterprise policies (`<Firefox>\\distribution\\policies.json`).

- `ExtensionSettings`: the signed XPI is `force_installed` from a local `file:///` URL, so it
  cannot be removed or disabled.
- `DisablePrivateBrowsing`, `DNSOverHTTPS` off and locked (DoH would skip `hosts`),
  `BlockAboutConfig`, `DisableDeveloperTools` (also blocks `about:debugging`, i.e. temporary
  add-ons).
- `WebsiteFilter.Block`: the policy's `blocked_sites` (domain and subdomains). Without a
  signed XPI there is no gate in Firefox, so YouTube is blocked outright (fail closed).

A `policies.json` that was there before and is not ours is kept as a backup and restored on
removal. The XPI itself is checked against the sha256 recorded by the installer and restored
from the pristine copy if it changed.
"""

import hashlib
import json
from pathlib import Path
from typing import Any

from app.enforce.backend import LayerBackend
from app.enforce.layers import DesiredState, LayerCheck, LayerId, digest

EXTENSION_ID = "brain-smooch-desktop@local"
XPI_NAME = "brain-smooch.xpi"
BACKUP_SUFFIX = ".brainsmooch-backup"
YOUTUBE_PATTERNS = (
    "*://*.youtube.com/*",
    "*://*.youtu.be/*",
    "*://*.youtube-nocookie.com/*",
)


def site_pattern(site: str) -> str:
    """`reddit.com` -> `*://*.reddit.com/*` (a match pattern: domain and subdomains)."""
    return f"*://*.{site}/*"


def xpi_file_url(path: Path) -> str:
    """`C:\\ProgramData\\BrainSmooch\\extension\\x.xpi` -> `file:///C:/ProgramData/...`."""
    return "file:///" + str(path).replace("\\", "/").lstrip("/")


def policies_document(desired: DesiredState) -> dict[str, Any]:
    block = [site_pattern(site) for site in desired.blocked_sites]
    policies: dict[str, Any] = {}
    if desired.xpi_url:
        policies["ExtensionSettings"] = {
            EXTENSION_ID: {"installation_mode": "force_installed", "install_url": desired.xpi_url}
        }
    else:
        block = list(YOUTUBE_PATTERNS) + block
    policies |= {
        "DisablePrivateBrowsing": True,
        "DNSOverHTTPS": {"Enabled": False, "Locked": True},
        "BlockAboutConfig": True,
        "DisableDeveloperTools": True,
        "WebsiteFilter": {"Block": block, "Exceptions": []},
    }
    return {"policies": policies}


def render_policies(desired: DesiredState) -> bytes:
    return (json.dumps(policies_document(desired), indent=2) + "\n").encode("utf-8")


def _parse(data: bytes | None) -> Any:
    if data is None:
        return None
    try:
        return json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return {"__unparseable__": hashlib.sha256(data).hexdigest()}


def is_ours(document: Any) -> bool:
    try:
        return EXTENSION_ID in document["policies"].get("ExtensionSettings", {}) or (
            document["policies"].get("DisableDeveloperTools") is True
            and "WebsiteFilter" in document["policies"]
            and document["policies"].get("BlockAboutConfig") is True
        )
    except (KeyError, TypeError, AttributeError):
        return False


class XpiStore:
    """`extension\\brain-smooch.xpi` (what Firefox installs), a pristine copy and its sha256,
    all written by the installer under `C:\\ProgramData\\BrainSmooch\\`."""

    def __init__(self, backend: LayerBackend, directory: Path) -> None:
        self._backend = backend
        self.installed = directory / XPI_NAME
        self.pristine = directory / "pristine" / XPI_NAME
        self.hash_file = directory / f"{XPI_NAME}.sha256"

    def expected_hash(self) -> str | None:
        data = self._backend.read_bytes(self.hash_file)
        return data.decode("ascii", "ignore").strip().lower() or None if data else None

    def available(self) -> bool:
        return self.expected_hash() is not None and (
            self._backend.read_bytes(self.installed) is not None
            or self._backend.read_bytes(self.pristine) is not None
        )

    def url(self) -> str | None:
        return xpi_file_url(self.installed) if self.available() else None

    def intact(self) -> bool:
        data = self._backend.read_bytes(self.installed)
        return data is not None and hashlib.sha256(data).hexdigest() == self.expected_hash()

    def restore(self) -> bool:
        data = self._backend.read_bytes(self.pristine)
        if data is None or hashlib.sha256(data).hexdigest() != self.expected_hash():
            return False
        self._backend.write_bytes(self.installed, data)
        return True


class FirefoxPoliciesLayer:
    id: LayerId = "E4"
    key = "firefox_policies"
    managed = True
    needs_admin = True

    def __init__(self, backend: LayerBackend, firefox_dir: Path, xpi: XpiStore) -> None:
        self._backend = backend
        self._firefox_dir = firefox_dir
        self.path = firefox_dir / "distribution" / "policies.json"
        self.backup = self.path.with_name(self.path.name + BACKUP_SUFFIX)
        self._xpi = xpi

    def check(self, desired: DesiredState) -> LayerCheck:
        if not self._backend.is_dir(self._firefox_dir):
            return LayerCheck("unavailable", f"Firefox not found in {self._firefox_dir}")
        actual = _parse(self._backend.read_bytes(self.path))
        if actual is None:
            return LayerCheck("absent", "policies.json missing")
        if digest(actual) != digest(policies_document(desired)):
            return LayerCheck("drift", "policies.json differs")
        if desired.xpi_url and not self._xpi.intact():
            return LayerCheck("drift", "signed XPI missing or altered")
        if not desired.xpi_url:
            return LayerCheck.ok("no signed XPI: YouTube blocked in Firefox")
        return LayerCheck.ok()

    def apply(self, desired: DesiredState) -> None:
        if not self._backend.is_dir(self._firefox_dir):
            return
        if desired.xpi_url and not self._xpi.intact():
            self._xpi.restore()
        current = self._backend.read_bytes(self.path)
        if (
            current is not None
            and not is_ours(_parse(current))
            and self._backend.read_bytes(self.backup) is None
        ):
            self._backend.write_bytes(self.backup, current)
        rendered = render_policies(desired)
        if current != rendered:
            self._backend.write_bytes(self.path, rendered)

    def remove(self) -> None:
        backup = self._backend.read_bytes(self.backup)
        if backup is not None:
            self._backend.write_bytes(self.path, backup)
            self._backend.delete_file(self.backup)
        elif self._backend.read_bytes(self.path) is not None:
            self._backend.delete_file(self.path)

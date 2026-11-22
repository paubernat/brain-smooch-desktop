"""E6: `hosts` entries for the policy's `blocked_sites`, inside a marked block:

    # BEGIN BrainSmooch (managed by the Brain Smooch service; do not edit)
    0.0.0.0 reddit.com
    0.0.0.0 www.reddit.com
    :: reddit.com
    :: www.reddit.com
    # END BrainSmooch

Idempotent: the block is rebuilt from scratch and everything outside it is preserved byte
for byte (line endings included). `hosts` has no wildcards, so each site gets the bare domain
and `www.`; the browser policies (E4/E5) cover the other subdomains. With no blocked sites the
block is removed.
"""

import re
from pathlib import Path

from app.enforce.backend import LayerBackend
from app.enforce.layers import DesiredState, LayerCheck, LayerId

BEGIN = "# BEGIN BrainSmooch"
BEGIN_LINE = f"{BEGIN} (managed by the Brain Smooch service; do not edit)"
END = "# END BrainSmooch"
SINKS = ("0.0.0.0", "::")
_ENTRY = re.compile(r"^\s*(?:0\.0\.0\.0|::)\s+\S+\s*$")


def block_lines(sites: tuple[str, ...]) -> list[str]:
    lines = [BEGIN_LINE]
    for sink in SINKS:
        for site in sites:
            lines += [f"{sink} {site}", f"{sink} www.{site}"]
    lines.append(END)
    return lines


def _newline(text: str) -> str:
    return "\n" if "\n" in text and "\r\n" not in text else "\r\n"


def strip_block(text: str) -> str:
    """`text` without any BrainSmooch block (also a duplicated or unterminated one: then
    only our entry lines right after BEGIN go)."""
    lines = text.splitlines(keepends=True)
    out: list[str] = []
    i = 0
    while i < len(lines):
        if lines[i].strip().startswith(BEGIN):
            end = next(
                (j for j in range(i + 1, len(lines)) if lines[j].strip() == END),
                None,
            )
            if end is None:
                j = i + 1
                while j < len(lines) and _ENTRY.match(lines[j].rstrip("\r\n")):
                    j += 1
                i = j
            else:
                i = end + 1
            continue
        out.append(lines[i])
        i += 1
    return "".join(out)


def parse_block(text: str) -> list[str] | None:
    """Lines inside the (first, complete) block, or None if there is none."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith(BEGIN):
            for j in range(i + 1, len(lines)):
                if lines[j].strip() == END:
                    return [entry.strip() for entry in lines[i + 1 : j] if entry.strip()]
            return None
    return None


def blocked_hosts(text: str) -> set[str]:
    """Host names sunk by our block."""
    entries = parse_block(text) or []
    return {entry.split()[1] for entry in entries if _ENTRY.match(entry)}


def render(text: str, sites: tuple[str, ...]) -> str:
    """`text` with exactly one up-to-date block at the end (none if `sites` is empty)."""
    base = strip_block(text)
    if not sites:
        return base
    nl = _newline(text)
    if base and not base.endswith(("\n", "\r")):
        base += nl
    return base + nl.join(block_lines(sites)) + nl


def _decode(data: bytes | None) -> str:
    # hosts is ASCII in practice; surrogateescape keeps any other byte intact on write.
    return "" if data is None else data.decode("utf-8", "surrogateescape")


def _encode(text: str) -> bytes:
    return text.encode("utf-8", "surrogateescape")


class HostsLayer:
    id: LayerId = "E6"
    key = "hosts"
    managed = True
    needs_admin = True

    def __init__(self, backend: LayerBackend, path: Path) -> None:
        self._backend = backend
        self.path = path

    def check(self, desired: DesiredState) -> LayerCheck:
        text = _decode(self._backend.read_bytes(self.path))
        if render(text, desired.blocked_sites) == text:
            return LayerCheck.ok(f"{len(desired.blocked_sites)} site(s)")
        if parse_block(text) is None and desired.blocked_sites:
            return LayerCheck("absent", "no BrainSmooch block in hosts")
        return LayerCheck("drift", "hosts block differs")

    def apply(self, desired: DesiredState) -> None:
        data = self._backend.read_bytes(self.path)
        text = _decode(data)
        updated = render(text, desired.blocked_sites)
        if updated != text:
            self._backend.write_bytes(self.path, _encode(updated))
            self._backend.flush_dns()

    def remove(self) -> None:
        data = self._backend.read_bytes(self.path)
        if data is None:
            return
        text = _decode(data)
        stripped = strip_block(text)
        if stripped != text:
            self._backend.write_bytes(self.path, _encode(stripped))
            self._backend.flush_dns()

"""E5: Edge and Chrome policies in the registry (`HKLM\\SOFTWARE\\Policies\\...`).

Windows Home has no gpedit, but both browsers read these keys anyway. Applied even if the
browser is not installed (it would pick them up on install); the browser watch (E7) closes
them in any case.

- `URLBlocklist` (subkey, values "1".."N"): all of YouTube plus the policy's `blocked_sites`
  (a bare domain blocks it and its subdomains).
- InPrivate / Incognito unavailable, DoH off, guest mode off.

Only our own values are written and removed; other policies in those keys are left alone.
The `URLBlocklist` subkey is entirely ours.
"""

from dataclasses import dataclass

from app.enforce.backend import LayerBackend, RegValue
from app.enforce.layers import DesiredState, LayerCheck, LayerId, digest

YOUTUBE_DOMAINS = ("youtube.com", "youtu.be", "youtube-nocookie.com", "youtubekids.com")
BLOCKLIST_SUBKEY = "URLBlocklist"


@dataclass(frozen=True)
class ChromiumBrowser:
    name: str
    key: str
    private_mode_policy: str

    @property
    def blocklist_key(self) -> str:
        return f"{self.key}\\{BLOCKLIST_SUBKEY}"


EDGE = ChromiumBrowser("Edge", r"SOFTWARE\Policies\Microsoft\Edge", "InPrivateModeAvailability")
CHROME = ChromiumBrowser("Chrome", r"SOFTWARE\Policies\Google\Chrome", "IncognitoModeAvailability")
BROWSERS = (EDGE, CHROME)


def policy_values(browser: ChromiumBrowser) -> dict[str, RegValue]:
    return {
        browser.private_mode_policy: 1,  # 1 = disabled
        "DnsOverHttpsMode": "off",
        "BrowserGuestModeEnabled": 0,
    }


def blocklist(sites: tuple[str, ...]) -> list[str]:
    seen: list[str] = []
    for domain in (*YOUTUBE_DOMAINS, *sites):
        if domain not in seen:
            seen.append(domain)
    return seen


def blocklist_values(sites: tuple[str, ...]) -> dict[str, RegValue]:
    return {str(i): domain for i, domain in enumerate(blocklist(sites), start=1)}


class ChromiumPoliciesLayer:
    id: LayerId = "E5"
    key = "chromium_policies"
    managed = True
    needs_admin = True

    def __init__(self, backend: LayerBackend, browsers: tuple[ChromiumBrowser, ...] = BROWSERS):
        self._backend = backend
        self._browsers = browsers

    def check(self, desired: DesiredState) -> LayerCheck:
        absent: list[str] = []
        drift: list[str] = []
        for browser in self._browsers:
            values = self._backend.read_reg_values(browser.key)
            listed = self._backend.read_reg_values(browser.blocklist_key)
            if values is None and listed is None:
                absent.append(browser.name)
                continue
            wanted = policy_values(browser)
            ours = {name: (values or {}).get(name) for name in wanted}
            if digest(ours) != digest(wanted) or digest(listed or {}) != digest(
                blocklist_values(desired.blocked_sites)
            ):
                drift.append(browser.name)
        if drift:
            return LayerCheck("drift", f"altered: {', '.join(drift)}")
        if absent and len(absent) == len(self._browsers):
            return LayerCheck("absent", "no browser policies")
        if absent:
            return LayerCheck("drift", f"missing: {', '.join(absent)}")
        return LayerCheck.ok()

    def apply(self, desired: DesiredState) -> None:
        wanted_list = blocklist_values(desired.blocked_sites)
        for browser in self._browsers:
            values = self._backend.read_reg_values(browser.key) or {}
            wanted = policy_values(browser)
            if any(values.get(name) != value for name, value in wanted.items()):
                self._backend.set_reg_values(browser.key, wanted)
            listed = self._backend.read_reg_values(browser.blocklist_key)
            if listed != wanted_list:
                # Rewrite the whole subkey: stale numbered entries must not survive.
                if listed is not None:
                    self._backend.delete_reg_key(browser.blocklist_key)
                self._backend.set_reg_values(browser.blocklist_key, wanted_list)

    def remove(self) -> None:
        for browser in self._browsers:
            self._backend.delete_reg_key(browser.blocklist_key)
            values = self._backend.read_reg_values(browser.key)
            if values is None:
                continue
            for name in policy_values(browser):
                if name in values:
                    self._backend.delete_reg_value(browser.key, name)
            remaining = self._backend.read_reg_values(browser.key)
            if remaining is not None and not remaining:
                self._backend.delete_reg_key(browser.key)

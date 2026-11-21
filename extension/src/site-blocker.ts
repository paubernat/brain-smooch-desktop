// Blocks the extra websites of the policy (`blocked_sites`): top-level
// navigations to those domains (and their subdomains) are redirected to the
// extension's block page. The list comes from the service on startup and every
// minute and is cached in storage.local, so blocking keeps working while the
// service is down. The options page also writes the cache right after saving.
import { fetchService } from './service-http';
import { BLOCKED_SITES_KEY, blockedDomainFor, cleanDomainList } from './sites';

const REFRESH_ALARM = 'bsd-refresh-blocked-sites';
const REFRESH_MINUTES = 1;

/** In-memory copy; null until read from storage (the event page may have just woken up). */
let domains: string[] | null = null;

async function cachedDomains(): Promise<string[]> {
  if (domains) return domains;
  try {
    domains = cleanDomainList((await browser.storage.local.get(BLOCKED_SITES_KEY))[BLOCKED_SITES_KEY]);
  } catch {
    domains = [];
  }
  return domains;
}

/** Pulls the list from the service; on failure the cached list stays in force. */
export async function refreshBlockedSites(): Promise<void> {
  const res = await fetchService<{ content: { blocked_sites?: unknown } }>('GET', '/policy');
  if (!res.ok) return;
  domains = cleanDomainList(res.data.content.blocked_sites);
  await browser.storage.local.set({ [BLOCKED_SITES_KEY]: domains }).catch(() => undefined);
}

export function blockPageUrl(domain: string, url: string): string {
  const query = new URLSearchParams({ site: domain, url });
  return browser.runtime.getURL(`blocked.html?${query.toString()}`);
}

function decide(url: string, list: readonly string[]): browser.webRequest.BlockingResponse {
  const domain = blockedDomainFor(url, list);
  return domain ? { redirectUrl: blockPageUrl(domain, url) } : {};
}

export function startSiteBlocker(): void {
  browser.webRequest.onBeforeRequest.addListener(
    (details) => (domains ? decide(details.url, domains) : cachedDomains().then((list) => decide(details.url, list))),
    { urls: ['<all_urls>'], types: ['main_frame'] },
    ['blocking'],
  );
  browser.storage.onChanged.addListener((changes, area) => {
    const change = changes[BLOCKED_SITES_KEY];
    if (area === 'local' && change) domains = cleanDomainList(change.newValue);
  });
  browser.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === REFRESH_ALARM) void refreshBlockedSites();
  });
  void refreshBlockedSites();
}

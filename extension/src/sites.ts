// Extra blocked websites (policy `blocked_sites`): domain normalisation and
// host matching. Pure; shared by the options page, the background script and
// the block page. Same rule as `normalize_domain` in service/app/policy.py.

export type DomainError = 'empty' | 'invalid' | 'protected';

export type DomainResult = { ok: true; domain: string } | { ok: false; error: DomainError };

/** Storage key of the cached list (so blocking works while the service is down). */
export const BLOCKED_SITES_KEY = 'blockedSites';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
/** Never blockable: the label panel and the profile page depend on them. */
const PROTECTED = ['youtube.com', 'ytimg.com', 'googlevideo.com'];

/** Bare host of a URL or domain the user typed (no scheme, path, port, userinfo or "www."). */
function bareHost(raw: string): string {
  let text = raw.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  text = text.split(/[/?#]/, 1)[0] ?? '';
  const host = (text.split('@').pop() ?? '').split(':', 1)[0] ?? '';
  return host.replace(/\.+$/, '').replace(/^www\./, '');
}

export function normalizeDomain(raw: string): DomainResult {
  if (!raw.trim()) return { ok: false, error: 'empty' };
  let host = bareHost(raw);
  // Internationalised names (e.g. "bücher.example") become punycode, like the URL parser does.
  if ([...host].some((c) => c.charCodeAt(0) > 0x7f)) {
    try {
      host = new URL(`http://${host}`).hostname.replace(/^www\./, '');
    } catch {
      return { ok: false, error: 'invalid' };
    }
  }
  const labels = host.split('.');
  const tld = labels[labels.length - 1] ?? '';
  if (host.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TLD.test(tld)) {
    return { ok: false, error: 'invalid' };
  }
  if (PROTECTED.some((p) => hostMatches(host, p) || hostMatches(p, host))) return { ok: false, error: 'protected' };
  return { ok: true, domain: host };
}

/** `host` is `domain` or one of its subdomains. */
export function hostMatches(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.+$/, '');
  return h === domain || h.endsWith(`.${domain}`);
}

/** The blocked domain that covers `url`, or null (only http/https pages). */
export function blockedDomainFor(url: string, domains: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return domains.find((d) => hostMatches(parsed.hostname, d)) ?? null;
}

/** Valid, normalised, de-duplicated list (drops anything invalid, e.g. from an old cache). */
export function cleanDomainList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const r = normalizeDomain(v);
    if (r.ok && !out.includes(r.domain)) out.push(r.domain);
  }
  return out;
}

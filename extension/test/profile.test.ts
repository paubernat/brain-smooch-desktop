// i18n completeness, domain normalisation/matching, channel lists, policy
// patching and the statue light mapping of the profile page.
import { describe, expect, it } from 'vitest';
import { channelTier, withChannel } from '../src/channel-lists';
import { percent, usd } from '../src/options/format';
import { CATALOGUES, FALLBACK_LANG, LANGS, detectLang, format, placeholders, t, tn } from '../src/options/i18n';
import { es } from '../src/options/i18n/es';
import { STATUE_SEGMENTS, litSegments, manualLight, raiseLight, wizardLight } from '../src/options/progress';
import { parseRoute } from '../src/options/router';
import { isSetupComplete, parseSetup } from '../src/options/setup-state';
import { initialState, withDraft, wizardMilestones } from '../src/options/wizard/state';
import { patchPolicy } from '../src/policy-patch';
import { blockedDomainFor, cleanDomainList, hostMatches, normalizeDomain } from '../src/sites';
import type { ApiResult } from '../src/api-messages';
import type { PolicyContent } from '../src/options/types';

/** setLang() writes to storage; tests switch the language through the module state only. */
async function withLang<T>(lang: 'en' | 'es' | 'ca', fn: () => T): Promise<T> {
  const g = globalThis as { browser?: unknown };
  const previous = g.browser;
  g.browser = { storage: { local: { set: async () => undefined } } };
  const { setLang } = await import('../src/options/i18n');
  setLang(lang);
  try {
    return fn();
  } finally {
    setLang(FALLBACK_LANG);
    g.browser = previous;
  }
}

describe('i18n catalogues', () => {
  const reference = Object.keys(es).sort();

  it.each(LANGS)('%s has exactly the reference keys, all non-empty', (lang) => {
    const catalogue = CATALOGUES[lang];
    expect(Object.keys(catalogue).sort()).toEqual(reference);
    for (const key of reference) expect(catalogue[key as keyof typeof es].trim(), `${lang}:${key}`).not.toBe('');
  });

  it.each(LANGS)('%s uses the same placeholders as Spanish', (lang) => {
    for (const key of reference) {
      const k = key as keyof typeof es;
      expect(placeholders(CATALOGUES[lang][k]), `${lang}:${key}`).toEqual(placeholders(es[k]));
    }
  });

  it('pairs every plural key', () => {
    for (const key of reference.filter((k) => k.endsWith('.one'))) expect(reference).toContain(key.replace(/\.one$/, '.other'));
  });

  it('detects the browser language with a Spanish fallback', () => {
    expect(detectLang('ca-ES')).toBe('ca');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('es')).toBe('es');
    expect(detectLang('fr-FR')).toBe('es');
    expect(detectLang(undefined)).toBe('es');
  });

  it('formats placeholders and plurals', () => {
    expect(format('{a} y {b}', { a: 1 })).toBe('1 y {b}');
    expect(tn(1, 'calibration.pending')).toBe('1 etiqueta pendiente');
    expect(tn(3, 'calibration.pending')).toBe('3 etiquetas pendientes');
  });

  it('switches language for strings and number formats', async () => {
    await withLang('en', () => {
      expect(t('sites.title')).toBe('Block extra sites');
      expect(percent(0.756)).toBe('76%');
      expect(usd(1.5)).toBe('$1.50');
    });
    await withLang('ca', () => expect(t('landing.title')).toBe('Configura el teu perfil'));
    expect(t('landing.title')).toBe('Configura tu perfil');
  });
});

describe('blocked sites', () => {
  it('normalises URLs and domains to the bare domain', () => {
    expect(normalizeDomain('reddit.com')).toEqual({ ok: true, domain: 'reddit.com' });
    expect(normalizeDomain('  https://www.Reddit.com/r/python?x=1 ')).toEqual({ ok: true, domain: 'reddit.com' });
    expect(normalizeDomain('http://user@news.ycombinator.com:8080/x')).toEqual({ ok: true, domain: 'news.ycombinator.com' });
    expect(normalizeDomain('www.twitch.tv.')).toEqual({ ok: true, domain: 'twitch.tv' });
    expect(normalizeDomain('bücher.example')).toEqual({ ok: true, domain: 'xn--bcher-kva.example' });
  });

  it('rejects empty, invalid and protected values', () => {
    expect(normalizeDomain('  ')).toEqual({ ok: false, error: 'empty' });
    for (const bad of ['reddit', '127.0.0.1', 'foo..com', '-bad.com', 'a b.com', 'x.c0m']) {
      expect(normalizeDomain(bad), bad).toEqual({ ok: false, error: 'invalid' });
    }
    expect(normalizeDomain('m.youtube.com')).toEqual({ ok: false, error: 'protected' });
    expect(normalizeDomain('https://youtube.com/watch')).toEqual({ ok: false, error: 'protected' });
  });

  it('matches the domain and its subdomains only', () => {
    expect(hostMatches('reddit.com', 'reddit.com')).toBe(true);
    expect(hostMatches('old.reddit.com', 'reddit.com')).toBe(true);
    expect(hostMatches('notreddit.com', 'reddit.com')).toBe(false);
    expect(hostMatches('reddit.com.evil.org', 'reddit.com')).toBe(false);
    expect(blockedDomainFor('https://old.reddit.com/r/x', ['twitch.tv', 'reddit.com'])).toBe('reddit.com');
    expect(blockedDomainFor('https://example.org/', ['reddit.com'])).toBeNull();
    expect(blockedDomainFor('moz-extension://abc/options.html', ['abc'])).toBeNull();
    expect(blockedDomainFor('not a url', ['reddit.com'])).toBeNull();
  });

  it('cleans a cached list', () => {
    expect(cleanDomainList(['Reddit.com', 'reddit.com', 'bad', 42, 'twitch.tv'])).toEqual(['reddit.com', 'twitch.tv']);
    expect(cleanDomainList(null)).toEqual([]);
  });
});

describe('channel lists', () => {
  const lists = { NO: ['NBA'], LIMITADO: ['Atrioc'], LIBRE: [] };

  it('finds the tier case-insensitively', () => {
    expect(channelTier(lists, 'atrioc')).toBe('LIMITADO');
    expect(channelTier(lists, 'Fireship')).toBeNull();
    expect(channelTier(lists, '  ')).toBeNull();
  });

  it('keeps a name in one list only', () => {
    expect(withChannel(lists, 'ATRIOC', 'LIBRE')).toEqual({ NO: ['NBA'], LIMITADO: [], LIBRE: ['ATRIOC'] });
    expect(withChannel(lists, 'nba', null)).toEqual({ NO: [], LIMITADO: ['Atrioc'], LIBRE: [] });
    expect(withChannel({}, 'Fireship', 'LIBRE')).toEqual({ NO: [], LIMITADO: [], LIBRE: ['Fireship'] });
  });
});

describe('patchPolicy', () => {
  interface P {
    version: number;
    content: { sites: string[] };
  }

  function server(conflicts: number) {
    let stored: P = { version: 1, content: { sites: [] } };
    let left = conflicts;
    const puts: number[] = [];
    return {
      puts,
      transport: {
        get: async (): Promise<ApiResult<P>> => ({ ok: true, status: 200, data: stored }),
        put: async (content: P['content'], expected: number): Promise<ApiResult<P>> => {
          puts.push(expected);
          if (left-- > 0) {
            stored = { version: stored.version + 1, content: stored.content }; // someone else saved
            return { ok: false, status: 409, error: 'conflict' };
          }
          stored = { version: stored.version + 1, content };
          return { ok: true, status: 200, data: stored };
        },
      },
    };
  }

  it('re-reads and retries after a 409', async () => {
    const s = server(1);
    const res = await patchPolicy(s.transport, (c) => ({ sites: [...c.sites, 'reddit.com'] }));
    expect(res.ok && res.data.content.sites).toEqual(['reddit.com']);
    expect(res.changed).toBe(true);
    expect(s.puts).toEqual([1, 2]);
  });

  it('does not write when nothing changes', async () => {
    const s = server(0);
    const res = await patchPolicy(s.transport, () => null);
    expect(res.ok).toBe(true);
    expect(res.changed).toBe(false);
    expect(s.puts).toEqual([]);
  });
});

describe('statue light', () => {
  const POLICY: PolicyContent = {
    question: { id: 'tier', instructions: 'x', options: { NO: { description: 'a' }, LIMITADO: { description: 'b' }, LIBRE: { description: 'c' } } },
    auxiliary_questions: [],
    channel_lists: {},
  };

  it('maps wizard steps to 0 / 25 / 50 / 75 / 100 %', () => {
    const state = initialState();
    expect(wizardLight(wizardMilestones(state, false))).toBe(0);
    const described = { ...state, preferences: { ...state.preferences, libre: 'piano jazz' } };
    expect(wizardLight(wizardMilestones(described, false))).toBe(0.25);
    const drafted = withDraft(described, POLICY);
    expect(wizardLight(wizardMilestones(drafted, false))).toBe(0.5);
    expect(wizardLight(wizardMilestones({ ...drafted, step: 'tune' }, false))).toBe(0.75);
    expect(wizardLight(wizardMilestones(drafted, true))).toBe(1);
  });

  it('lights segments in order, the head only at 100 %', () => {
    expect(litSegments(0)).toEqual([]);
    expect(litSegments(0.25)).toEqual(['base']);
    expect(litSegments(0.5)).toEqual(['base', 'legs']);
    expect(litSegments(0.75)).toEqual(['base', 'legs', 'torso']);
    expect(litSegments(1)).toEqual([...STATUE_SEGMENTS]);
  });

  it('adds 25 % per manual section and 100 % on save; never dims', () => {
    expect(manualLight({ instructions: true, tiers: false, extras: false, saved: false })).toBe(0.25);
    expect(manualLight({ instructions: true, tiers: true, extras: true, saved: false })).toBe(0.75);
    expect(manualLight({ instructions: false, tiers: false, extras: false, saved: true })).toBe(1);
    expect(raiseLight(0.75, 0.25)).toBe(0.75);
    expect(raiseLight(0.25, 2)).toBe(1);
  });

  it('parses the stored setup state defensively', () => {
    expect(parseSetup(undefined)).toEqual({ policySaved: false, sitesReviewed: false, launched: false, light: { manual: 0, agentic: 0 } });
    const s = parseSetup({ policySaved: true, sitesReviewed: true, light: { manual: 3, agentic: 'x' } });
    expect(s.light).toEqual({ manual: 1, agentic: 0 });
    expect(isSetupComplete(s)).toBe(true);
    expect(isSetupComplete({ ...s, sitesReviewed: false })).toBe(false);
  });

  it('routes the new steps', () => {
    expect(parseRoute('#webs')).toBe('sites');
    expect(parseRoute('#canales')).toBe('channels');
    expect(parseRoute('#configurar')).toBe('setup');
  });
});


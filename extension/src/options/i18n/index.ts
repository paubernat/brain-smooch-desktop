// UI language of the options page and the block page: English, Spanish or
// Catalan. Stored in browser.storage.local; the default comes from the
// browser's language, falling back to Spanish.
import { ca } from './ca';
import { en } from './en';
import { es } from './es';
import type { Catalogue, Lang, MessageKey, Params, PluralKey } from './types';

export type { Lang, MessageKey, Params, PluralKey } from './types';

export const LANGS: readonly Lang[] = ['en', 'es', 'ca'];
export const LANG_NAMES: Readonly<Record<Lang, string>> = { en: 'English', es: 'Español', ca: 'Català' };
export const LANG_STORAGE_KEY = 'uiLanguage';
export const FALLBACK_LANG: Lang = 'es';

export const CATALOGUES: Readonly<Record<Lang, Catalogue>> = { en, es, ca };
const LOCALES: Readonly<Record<Lang, string>> = { en: 'en-GB', es: 'es-ES', ca: 'ca-ES' };

let current: Lang = FALLBACK_LANG;
const listeners = new Set<(lang: Lang) => void>();

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** "ca-ES" -> ca, "en-US" -> en, "es" -> es, anything else -> Spanish. */
export function detectLang(browserLanguage: string | undefined): Lang {
  const base = (browserLanguage ?? '').toLowerCase().split(/[-_]/)[0];
  return isLang(base) ? base : FALLBACK_LANG;
}

export function currentLang(): Lang {
  return current;
}

export function currentLocale(): string {
  return LOCALES[current];
}

/** `{name}` placeholders of a string, sorted (used by the completeness test). */
export function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();
}

export function format(text: string, params: Params = {}): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}

export function t(key: MessageKey, params?: Params): string {
  return format(CATALOGUES[current][key] ?? es[key] ?? key, params);
}

/** Plural pair `<key>.one` / `<key>.other`, with {n} filled in. */
export function tn(n: number, key: PluralKey, params: Params = {}): string {
  const form = n === 1 ? 'one' : 'other';
  return t(`${key}.${form}` as MessageKey, { ...params, n });
}

export function setLang(lang: Lang, persist = true): void {
  const changed = lang !== current;
  current = lang;
  if (persist) void browser.storage.local.set({ [LANG_STORAGE_KEY]: lang }).catch(() => undefined);
  if (changed) for (const listener of listeners) listener(lang);
}

export function onLangChange(listener: (lang: Lang) => void): void {
  listeners.add(listener);
}

/** Stored choice, else the browser's language. Call before the first render. */
export async function initLang(): Promise<Lang> {
  let stored: unknown;
  try {
    stored = (await browser.storage.local.get(LANG_STORAGE_KEY))[LANG_STORAGE_KEY];
  } catch {
    stored = undefined;
  }
  const lang = isLang(stored) ? stored : detectLang(navigator.language);
  setLang(lang, false);
  return lang;
}

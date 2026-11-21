// Typed keys of the UI strings: the Spanish catalogue is the reference, so a
// key missing from (or extra in) another language is a compile error.
import type { es } from './es';

export type Lang = 'en' | 'es' | 'ca';
export type MessageKey = keyof typeof es;
export type Catalogue = Record<MessageKey, string>;
export type Params = Record<string, string | number>;

/** "a.b.one" + "a.b.other" -> "a.b" (keys used with `tn`). */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}.one` ? Base : never) : never;

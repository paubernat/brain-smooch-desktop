// Keyboard shortcuts of the label panel: Alt+1 NO, Alt+2 LIMITADO, Alt+3 LIBRE.
//
// Matched by physical key (`code`, layout independent) with a fallback on the
// produced character (`key`) for keyboards that report another code. AltGr
// (Ctrl+Alt on Windows, e.g. AltGr+3 = '#' on a Spanish layout) is never a
// shortcut: it types characters.
import { LABELS, type Label } from '../types';

export type ShortcutEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code' | 'key'> & {
  getModifierState?: (key: string) => boolean;
};

const DIGITS = ['1', '2', '3'] as const;

/** `Alt+<n>` for each label, in panel order. */
export const SHORTCUTS: Readonly<Record<Label, string>> = {
  NO: 'Alt+1',
  LIMITADO: 'Alt+2',
  LIBRE: 'Alt+3',
};

export function shortcutLabel(e: ShortcutEvent): Label | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.getModifierState?.('AltGraph')) return null;
  let idx = DIGITS.findIndex((d) => e.code === `Digit${d}`);
  if (idx < 0) idx = DIGITS.findIndex((d) => e.key === d);
  return LABELS[idx] ?? null;
}

// Keeps the wizard's texts and draft in browser.storage.local so closing the
// tab does not lose what the user wrote. Evaluations are not stored.
import type { WizardState } from './state';

const KEY = 'profileWizard';
const DEBOUNCE_MS = 400;

type Saved = Pick<WizardState, 'step' | 'preferences' | 'draft' | 'rationale' | 'changelog'>;

let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadSaved(): Promise<Partial<Saved>> {
  try {
    const stored = (await browser.storage.local.get(KEY))[KEY];
    return stored && typeof stored === 'object' ? (stored as Partial<Saved>) : {};
  } catch {
    return {};
  }
}

export function saveSoon(state: WizardState): void {
  clearTimeout(timer);
  const saved: Saved = {
    step: state.step,
    preferences: state.preferences,
    draft: state.draft,
    rationale: state.rationale,
    changelog: state.changelog,
  };
  timer = setTimeout(() => void browser.storage.local.set({ [KEY]: saved }).catch(() => undefined), DEBOUNCE_MS);
}

export async function clearSaved(): Promise<void> {
  clearTimeout(timer);
  try {
    await browser.storage.local.set({ [KEY]: null });
  } catch {
    // storage unavailable: nothing to clear
  }
}

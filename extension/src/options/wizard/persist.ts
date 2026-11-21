// Keeps the wizard's texts and draft in local storage so closing the
// tab does not lose what the user wrote. Evaluations are not stored.
import { storageGet, storageSet } from '../../platform/storage';
import type { WizardState } from './state';

const KEY = 'profileWizard';
const DEBOUNCE_MS = 400;

type Saved = Pick<WizardState, 'step' | 'preferences' | 'draft' | 'rationale' | 'changelog'>;

let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadSaved(): Promise<Partial<Saved>> {
  const stored = await storageGet(KEY);
  return stored && typeof stored === 'object' ? (stored as Partial<Saved>) : {};
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
  timer = setTimeout(() => void storageSet({ [KEY]: saved }), DEBOUNCE_MS);
}

export async function clearSaved(): Promise<void> {
  clearTimeout(timer);
  await storageSet({ [KEY]: null });
}

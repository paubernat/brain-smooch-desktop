// Setup progress of the profile page, kept in browser.storage.local under
// `setupState` (per browser profile, not in the service):
// - policySaved: a policy was saved from this page (manual, agentic, test,
//   calibration or the sites step);
// - sitesReviewed: the "Block extra sites" step was completed;
// - launched: the rocket was launched (the landing then shows the dashboard);
// - light: how lit each statue is (maximum reached, 0..1).
// setup_complete = policySaved && sitesReviewed (unlocks the rocket).
import { raiseLight } from './progress';

export type StatueMode = 'manual' | 'agentic';

export interface SetupState {
  policySaved: boolean;
  sitesReviewed: boolean;
  launched: boolean;
  light: Record<StatueMode, number>;
}

const KEY = 'setupState';

export function emptySetup(): SetupState {
  return { policySaved: false, sitesReviewed: false, launched: false, light: { manual: 0, agentic: 0 } };
}

export function isSetupComplete(s: SetupState): boolean {
  return s.policySaved && s.sitesReviewed;
}

function clamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

/** Tolerates missing or malformed stored values. */
export function parseSetup(raw: unknown): SetupState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<SetupState>;
  const light = (r.light && typeof r.light === 'object' ? r.light : {}) as Partial<Record<StatueMode, unknown>>;
  return {
    policySaved: r.policySaved === true,
    sitesReviewed: r.sitesReviewed === true,
    launched: r.launched === true,
    light: { manual: clamp(light.manual), agentic: clamp(light.agentic) },
  };
}

export async function loadSetup(): Promise<SetupState> {
  try {
    return parseSetup((await browser.storage.local.get(KEY))[KEY]);
  } catch {
    return emptySetup();
  }
}

let queue: Promise<SetupState> = Promise.resolve(emptySetup());

/** Read-modify-write, serialised so concurrent updates do not clobber each other. */
export function updateSetup(change: (s: SetupState) => SetupState): Promise<SetupState> {
  queue = queue.then(async () => {
    const next = change(await loadSetup());
    await browser.storage.local.set({ [KEY]: next }).catch(() => undefined);
    return next;
  });
  return queue;
}

export function raiseStatue(mode: StatueMode, light: number): Promise<SetupState> {
  return updateSetup((s) => ({ ...s, light: { ...s.light, [mode]: raiseLight(s.light[mode], light) } }));
}

/** A save from the page; `mode` also lights that statue fully. */
export function markPolicySaved(mode?: StatueMode): Promise<SetupState> {
  return updateSetup((s) => ({
    ...s,
    policySaved: true,
    light: mode ? { ...s.light, [mode]: 1 } : s.light,
  }));
}

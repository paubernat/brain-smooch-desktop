// Gate settings (GET /settings/enforcement) and their cached copy in
// browser.storage.local. Pure parsing, unit-tested.
import type { EnforcementSettings } from '../types';

export const ENFORCEMENT_KEY = 'enforcement';

export const DEFAULT_ENFORCEMENT: EnforcementSettings = {
  mode: 'off',
  service_timeout_s: 6,
  decision_timeout_s: 45,
  block_shorts_feed: true,
};

function seconds(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Tolerates a missing or malformed cache (then: not enforcing). */
export function parseEnforcement(raw: unknown): EnforcementSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof EnforcementSettings, unknown>>;
  return {
    mode: r.mode === 'soft' ? 'soft' : 'off',
    service_timeout_s: seconds(r.service_timeout_s, DEFAULT_ENFORCEMENT.service_timeout_s, 1, 30),
    decision_timeout_s: seconds(r.decision_timeout_s, DEFAULT_ENFORCEMENT.decision_timeout_s, 5, 180),
    block_shorts_feed: r.block_shorts_feed !== false,
  };
}

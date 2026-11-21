// Client of the lock endpoints (/lock/*): custodian password, admin session
// and delayed relax requests. The session cookie is HttpOnly; the CSRF token
// comes in the JSON and is kept in memory (service-http.ts sends it with every
// non-GET request). Reloading the page recovers it from /lock/status.
import type { ApiResult } from '../api-messages';
import { fetchService, setCsrfToken } from '../service-http';

export interface LockStatus {
  password_set: boolean;
  custodian: string;
  created_at: string | null;
  relax_delay_hours: number;
  session: { expires_at: number; csrf: string } | null;
  retry_after_s: number;
}

export interface RelaxRequest {
  id: number;
  kind: 'policy' | 'live' | 'enforcement' | 'quota' | 'lock';
  summary: string[];
  created_at: string;
  apply_after: string;
  status: 'pending' | 'applied' | 'cancelled' | 'conflict';
  resolved_at: string | null;
}

const listeners = new Set<(status: LockStatus) => void>();

/** Called whenever a lock answer arrives (the views refresh their lock state). */
export function onLockStatus(listener: (status: LockStatus) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function track(res: ApiResult<LockStatus>): ApiResult<LockStatus> {
  if (res.ok) {
    setCsrfToken(res.data.session?.csrf ?? null);
    for (const listener of listeners) listener(res.data);
  }
  return res;
}

export const lockApi = {
  status: async () => track(await fetchService<LockStatus>('GET', '/lock/status')),
  setup: async (custodian: string, password: string, passwordConfirm: string, relaxDelayHours: number) =>
    track(
      await fetchService<LockStatus>('POST', '/lock/setup', {
        custodian,
        password,
        password_confirm: passwordConfirm,
        relax_delay_hours: relaxDelayHours,
      }),
    ),
  login: async (password: string) => track(await fetchService<LockStatus>('POST', '/lock/login', { password })),
  logout: async () => track(await fetchService<LockStatus>('POST', '/lock/logout', {})),
  saveDelay: async (hours: number) => track(await fetchService<LockStatus>('PUT', '/lock/settings', { relax_delay_hours: hours })),
  requests: () => fetchService<RelaxRequest[]>('GET', '/lock/requests'),
  cancel: (id: number) => fetchService<RelaxRequest[]>('POST', `/lock/requests/${id}/cancel`, {}),
};

/** Seconds left in the admin session (0 = locked). */
export function sessionSecondsLeft(status: LockStatus, nowMs = Date.now()): number {
  if (!status.session) return 0;
  return Math.max(0, Math.round(status.session.expires_at - nowMs / 1000));
}

// Messages between content.ts and background.ts (runtime messaging).
//
// Why the background script does the HTTP calls: a content-script fetch runs
// with the youtube.com page as context (CORS + mixed-content rules from an
// https page to http://127.0.0.1). The background script runs on the
// extension origin (moz-extension://) and, with the http://127.0.0.1/* host
// permission, is not subject to the page's CORS; the service only has to
// allow moz-extension:// origins.

export type HttpMethod = 'GET' | 'POST' | 'PUT';

export interface ApiRequestMessage {
  type: 'bsd-api';
  method: HttpMethod;
  path: string;
  body?: unknown;
  /** Optional per-call timeout (the gate uses the fail-closed one). */
  timeoutMs?: number;
}

/** Sections of the local web the panel and the gate can link to (URL hash). */
export const OPTIONS_SECTIONS = ['calibracion', 'webs', 'candado'] as const;
export type OptionsSection = (typeof OPTIONS_SECTIONS)[number];

/** Content scripts cannot call runtime.openOptionsPage(); they ask the background. */
export interface OpenOptionsMessage {
  type: 'bsd-open-options';
  section?: OptionsSection;
}

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; error: string };

export const DEFAULT_SERVICE_PORT = 8765;
export const FEEDBACK_SUMMARY_PATH = '/policy/feedback?items=false';
export const POLICY_PATH = '/policy';
export const ENFORCEMENT_PATH = '/settings/enforcement';
export const UI_SETTINGS_PATH = '/settings/ui';
export const QUOTA_HEARTBEAT_PATH = '/quota/heartbeat';
export const ALLOWED_PATHS =
  /^\/(health|fichas(\/[A-Za-z0-9_-]{11})?|verdicts\/[A-Za-z0-9_-]{11}|labels(\/stats)?|policy|policy\/feedback\?items=false|settings\/(enforcement|ui)|quota\/heartbeat|quota\/today(\?[A-Za-z0-9_=&.-]*)?)$/;

/** The live verdict may wait for enrichment (≤ 8 s) and then for the judge (with retries). */
export const VERDICT_TIMEOUT_MS = 120_000;

/** Content scripts may ask for a shorter timeout (fail-closed gate); capped. */
export const MAX_TIMEOUT_MS = VERDICT_TIMEOUT_MS;

export function timeoutFor(path: string, requested?: number): number | undefined {
  if (typeof requested === 'number' && requested > 0) return Math.min(requested, MAX_TIMEOUT_MS);
  return path.startsWith('/verdicts/') ? VERDICT_TIMEOUT_MS : undefined;
}

/** GET/POST to the allowed paths; PUT only to /policy (the panel pins channels). */
export function isApiRequest(msg: unknown): msg is ApiRequestMessage {
  const m = msg as ApiRequestMessage;
  if (!m || m.type !== 'bsd-api' || typeof m.path !== 'string') return false;
  return m.method === 'GET' || m.method === 'POST' || (m.method === 'PUT' && m.path === POLICY_PATH);
}

export function isOpenOptions(msg: unknown): msg is OpenOptionsMessage {
  return !!msg && (msg as OpenOptionsMessage).type === 'bsd-open-options';
}

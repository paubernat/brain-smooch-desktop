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
}

/** Sections of the options page the panel can link to (hash of options.html). */
export const OPTIONS_SECTIONS = ['calibracion'] as const;
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
export const ALLOWED_PATHS = /^\/(health|fichas(\/[A-Za-z0-9_-]{11})?|labels(\/stats)?|policy\/feedback\?items=false)$/;

export function isApiRequest(msg: unknown): msg is ApiRequestMessage {
  const m = msg as ApiRequestMessage;
  return !!m && m.type === 'bsd-api' && (m.method === 'GET' || m.method === 'POST') && typeof m.path === 'string';
}

export function isOpenOptions(msg: unknown): msg is OpenOptionsMessage {
  return !!msg && (msg as OpenOptionsMessage).type === 'bsd-open-options';
}

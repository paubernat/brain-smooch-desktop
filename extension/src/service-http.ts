// HTTP to the local service. Works in two contexts:
// - extension pages / background (moz-extension://): absolute URL to
//   http://127.0.0.1:<port>, allowed by the service's CORS;
// - the local web served by the service itself (http://127.0.0.1:8765/):
//   same-origin relative URLs, the admin session cookie and the CSRF token.
// Content scripts go through background.ts.
import { DEFAULT_SERVICE_PORT, type ApiResult, type HttpMethod } from './api-messages';
import { isExtensionContext, storageGet } from './platform/storage';

export const DEFAULT_TIMEOUT_MS = 15000;
export const CSRF_HEADER = 'X-CSRF-Token';

/** CSRF token of the admin session (web context only; set by the lock client). */
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export async function servicePort(): Promise<number> {
  const servicePort = await storageGet('servicePort');
  return typeof servicePort === 'number' && servicePort > 0 ? servicePort : DEFAULT_SERVICE_PORT;
}

/** '' on the local web (same origin); the absolute service URL elsewhere. */
export async function serviceBase(): Promise<string> {
  if (!isExtensionContext()) return '';
  return `http://127.0.0.1:${await servicePort()}`;
}

/** URL of the local web (dashboard), optionally at a section (`#webs`, `#calibracion`...). */
export async function localWebUrl(section = ''): Promise<string> {
  const base = `http://127.0.0.1:${await servicePort()}/`;
  return section ? `${base}#${section}` : base;
}

/** FastAPI errors come as {"detail": "..."} (or a list of validation errors). */
export function errorText(data: unknown): string {
  if (typeof data === 'string') return data;
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  return JSON.stringify(detail ?? data);
}

/** A relaxing change with a configured delay is stored as a request (HTTP 202). */
export interface DeferredBody {
  deferred: true;
  request: { id: number; apply_after: string; summary: string[] };
}

export function isDeferred(data: unknown): data is DeferredBody {
  return !!data && typeof data === 'object' && (data as DeferredBody).deferred === true;
}

export async function fetchService<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = body !== undefined ? { 'content-type': 'application/json' } : {};
  if (csrfToken && method !== 'GET') headers[CSRF_HEADER] = csrfToken;
  try {
    const res = await fetch(`${await serviceBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'same-origin',
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) return { ok: false, status: res.status, error: errorText(data) };
    // Deferred relax request: not what the caller asked for, report it as such.
    if (res.status === 202 && isDeferred(data)) return { ok: false, status: 202, error: data.request.apply_after };
    return { ok: true, status: res.status, data: data as T };
  } catch (e) {
    return { ok: false, status: null, error: `service unreachable: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

// HTTP to the local service from an extension-origin context (background
// script or the options page). Content scripts go through background.ts.
import { DEFAULT_SERVICE_PORT, type ApiResult, type HttpMethod } from './api-messages';

export const DEFAULT_TIMEOUT_MS = 15000;

export async function serviceBase(): Promise<string> {
  const { servicePort } = await browser.storage.local.get('servicePort');
  const port = typeof servicePort === 'number' && servicePort > 0 ? servicePort : DEFAULT_SERVICE_PORT;
  return `http://127.0.0.1:${port}`;
}

/** FastAPI errors come as {"detail": "..."} (or a list of validation errors). */
export function errorText(data: unknown): string {
  if (typeof data === 'string') return data;
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string') return detail;
  return JSON.stringify(detail ?? data);
}

export async function fetchService<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${await serviceBase()}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) return { ok: false, status: res.status, error: errorText(data) };
    return { ok: true, status: res.status, data: data as T };
  } catch (e) {
    return { ok: false, status: null, error: `service unreachable: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

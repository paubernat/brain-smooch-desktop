// Background script: the only place that talks HTTP to the local service.
import { ALLOWED_PATHS, DEFAULT_SERVICE_PORT, isApiRequest, type ApiRequestMessage, type ApiResult } from './api-messages';

const TIMEOUT_MS = 15000;

async function serviceBase(): Promise<string> {
  const { servicePort } = await browser.storage.local.get('servicePort');
  const port = typeof servicePort === 'number' && servicePort > 0 ? servicePort : DEFAULT_SERVICE_PORT;
  return `http://127.0.0.1:${port}`;
}

async function callService(msg: ApiRequestMessage): Promise<ApiResult<unknown>> {
  if (!ALLOWED_PATHS.test(msg.path)) return { ok: false, status: null, error: `path not allowed: ${msg.path}` };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${await serviceBase()}${msg.path}`, {
      method: msg.method,
      headers: msg.body !== undefined ? { 'content-type': 'application/json' } : {},
      body: msg.body !== undefined ? JSON.stringify(msg.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) return { ok: false, status: res.status, error: typeof data === 'string' ? data : JSON.stringify(data) };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: null, error: `service unreachable: ${String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

browser.runtime.onMessage.addListener((message) => {
  // Only our own content scripts can message the background (no externally_connectable).
  if (!isApiRequest(message)) return undefined;
  return callService(message);
});

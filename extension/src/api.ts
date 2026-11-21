// Typed client for the local service (docs/api-contract.md). Runs in the
// content script and forwards every call to background.ts.
import type { ApiRequestMessage, ApiResult, HttpMethod, OpenOptionsMessage } from './api-messages';
import type { FichaPayload, FichaResponse, Label, LabelResponse } from './types';

async function call<T>(method: HttpMethod, path: string, body?: unknown): Promise<ApiResult<T>> {
  const msg: ApiRequestMessage = { type: 'bsd-api', method, path, body };
  try {
    const res = (await browser.runtime.sendMessage(msg)) as ApiResult<T> | undefined;
    return res ?? { ok: false, status: null, error: 'no response from background' };
  } catch (e) {
    return { ok: false, status: null, error: String(e) };
  }
}

export const api = {
  health: () => call<{ status: string }>('GET', '/health'),
  postFicha: (ficha: FichaPayload) => call<FichaResponse>('POST', '/fichas', ficha),
  getFicha: (videoId: string) => call<FichaResponse>('GET', `/fichas/${encodeURIComponent(videoId)}`),
  postLabel: (videoId: string, label: Label, reason?: string) =>
    call<LabelResponse>('POST', '/labels', reason ? { video_id: videoId, label, reason } : { video_id: videoId, label }),
  openOptions: () => {
    const msg: OpenOptionsMessage = { type: 'bsd-open-options' };
    return browser.runtime.sendMessage(msg).catch(() => undefined);
  },
};

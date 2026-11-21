// Typed client for the local service (docs/api-contract.md). Runs in the
// content script and forwards every call to background.ts.
import {
  FEEDBACK_SUMMARY_PATH,
  type ApiRequestMessage,
  type ApiResult,
  type HttpMethod,
  type OpenOptionsMessage,
  type OptionsSection,
} from './api-messages';
import type { FeedbackSummary, FichaPayload, FichaResponse, Label, LabelResponse, LiveVerdict } from './types';

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
  /** Live judge: rule, cache or a judge call (the service caches it). */
  requestVerdict: (videoId: string) => call<LiveVerdict>('POST', `/verdicts/${encodeURIComponent(videoId)}`),
  /** Latest verdict without calling the judge (404 if there is none yet). */
  getVerdict: (videoId: string) => call<LiveVerdict>('GET', `/verdicts/${encodeURIComponent(videoId)}`),
  /** Pending-label counts for the panel badge (without the item list). */
  feedbackSummary: () => call<FeedbackSummary>('GET', FEEDBACK_SUMMARY_PATH),
  openOptions: (section?: OptionsSection) => {
    const msg: OpenOptionsMessage = section ? { type: 'bsd-open-options', section } : { type: 'bsd-open-options' };
    return browser.runtime.sendMessage(msg).catch(() => undefined);
  },
};

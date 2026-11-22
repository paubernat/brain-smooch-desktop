// Typed client for the local service (docs/api-contract.md). Runs in the
// content script and forwards every call to background.ts.
import type { ChannelLists } from './channel-lists';
import type { PolicyTransport } from './policy-patch';
import {
  ENFORCEMENT_PATH,
  FEEDBACK_SUMMARY_PATH,
  POLICY_PATH,
  QUOTA_HEARTBEAT_PATH,
  type ApiRequestMessage,
  type ApiResult,
  type HttpMethod,
  type OpenOptionsMessage,
  type OptionsSection,
} from './api-messages';
import type {
  EnforcementSettings,
  FeedbackSummary,
  FichaPayload,
  FichaResponse,
  Label,
  LabelResponse,
  LiveVerdict,
  QuotaToday,
} from './types';

/** The policy as the panel sees it: only the channel lists matter, the rest is sent back as is. */
export type PanelPolicyContent = Record<string, unknown> & { channel_lists?: ChannelLists };
export interface PanelPolicy {
  version: number;
  content: PanelPolicyContent;
}

async function call<T>(method: HttpMethod, path: string, body?: unknown, timeoutMs?: number): Promise<ApiResult<T>> {
  const msg: ApiRequestMessage = timeoutMs ? { type: 'bsd-api', method, path, body, timeoutMs } : { type: 'bsd-api', method, path, body };
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
  getPolicy: () => call<PanelPolicy>('GET', POLICY_PATH),
  /** Gate settings; `timeoutMs` = the fail-closed timeout. */
  enforcement: (timeoutMs?: number) => call<EnforcementSettings>('GET', ENFORCEMENT_PATH, undefined, timeoutMs),
  quotaToday: (videoId: string, durationS: number | null, positionS: number | null, timeoutMs?: number) =>
    call<QuotaToday>('GET', quotaTodayPath(videoId, durationS, positionS), undefined, timeoutMs),
  quotaHeartbeat: (body: QuotaHeartbeat, timeoutMs?: number) => call<QuotaToday>('POST', QUOTA_HEARTBEAT_PATH, body, timeoutMs),
  putPolicy: (content: PanelPolicyContent, expectedVersion: number) =>
    call<PanelPolicy>('PUT', POLICY_PATH, { content, expected_version: expectedVersion }),
  openOptions: (section?: OptionsSection) => {
    const msg: OpenOptionsMessage = section ? { type: 'bsd-open-options', section } : { type: 'bsd-open-options' };
    return browser.runtime.sendMessage(msg).catch(() => undefined);
  },
};

export interface QuotaHeartbeat {
  video_id: string;
  seconds: number;
  duration_s: number | null;
  position_s: number | null;
  /** Tab id and increasing heartbeat number: the service ignores repeats and caps to wall time. */
  tab_id?: string;
  seq?: number;
}

export function quotaTodayPath(videoId: string, durationS: number | null, positionS: number | null): string {
  const query = new URLSearchParams({ video_id: videoId });
  if (durationS !== null && Number.isFinite(durationS)) query.set('duration_s', String(Math.round(durationS)));
  if (positionS !== null && Number.isFinite(positionS)) query.set('position_s', String(Math.round(positionS)));
  return `/quota/today?${query.toString()}`;
}

/** For patchPolicy (read-modify-write with retry on 409). */
export const panelPolicyTransport: PolicyTransport<PanelPolicyContent, PanelPolicy> = {
  get: () => api.getPolicy(),
  put: (content, expectedVersion) => api.putPolicy(content, expectedVersion),
};

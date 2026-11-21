// Gate state machine for the video on screen (PLAN-FASE2 §5, H1/H2). Pure
// reducer, unit-tested; gate.ts drives the DOM from it.
//
//   video ─► off            (enforcement off: labelling only)
//         ─► blocked        (Shorts feed scroll)
//         ─► deciding ─► playing free     (LIBRE)
//                     ─► checking quota ─► playing limited (LIMITADO, quota left)
//                     │                  ─► blocked quota
//                     ─► blocked verdict  (NO)
//                     ─► blocked service  (unreachable / timeout / error: fail closed)
//
// Every event carries the video id; events for another video are ignored, so
// a late answer can never unlock the next video.
import type { GateDecision, QuotaToday } from '../types';

export type FailureReason = 'unreachable' | 'timeout' | 'error';
export type BlockReason = 'verdict' | 'quota' | 'resume_tomorrow' | 'shorts_feed' | FailureReason;

export type GateState =
  | { kind: 'off' }
  | { kind: 'deciding'; videoId: string }
  | { kind: 'checking_quota'; videoId: string; gate: GateDecision }
  | { kind: 'playing'; videoId: string; limited: boolean; gate: GateDecision; quota: QuotaToday | null }
  | {
      kind: 'blocked';
      videoId: string;
      reason: BlockReason;
      /** Why the verdict blocks (rule or model) / error detail. */
      detail: string | null;
      gate: GateDecision | null;
      quota: QuotaToday | null;
    };

export type GateEvent =
  | { type: 'video'; videoId: string; enforcing: boolean; shortsScroll: boolean; blockShortsFeed: boolean }
  | { type: 'leave' }
  | { type: 'verdict'; videoId: string; gate: GateDecision; detail: string | null }
  | { type: 'quota'; videoId: string; quota: QuotaToday }
  | { type: 'failure'; videoId: string; reason: FailureReason; detail?: string | null };

export const INITIAL_GATE: GateState = { kind: 'off' };

function blocked(videoId: string, reason: BlockReason, extra: Partial<Extract<GateState, { kind: 'blocked' }>> = {}): GateState {
  return { kind: 'blocked', videoId, reason, detail: null, gate: null, quota: null, ...extra };
}

export function gateVideoId(state: GateState): string | null {
  return state.kind === 'off' ? null : state.videoId;
}

/** The player may run (nothing to enforce, or the verdict let it). */
export function allowsPlayback(state: GateState): boolean {
  return state.kind === 'off' || state.kind === 'playing';
}

/** Watched time of this video counts against the daily quota. */
export function countsQuota(state: GateState): boolean {
  return state.kind === 'playing' && state.limited;
}

export function gateReducer(state: GateState, event: GateEvent): GateState {
  if (event.type === 'leave') return INITIAL_GATE;
  if (event.type === 'video') {
    if (!event.enforcing) return INITIAL_GATE;
    if (event.shortsScroll && event.blockShortsFeed) return blocked(event.videoId, 'shorts_feed');
    return { kind: 'deciding', videoId: event.videoId };
  }
  if (gateVideoId(state) !== event.videoId) return state; // stale answer for another video
  switch (event.type) {
    case 'verdict':
      if (state.kind !== 'deciding') return state;
      if (event.gate.action === 'block') return blocked(event.videoId, 'verdict', { detail: event.detail, gate: event.gate });
      if (event.gate.action === 'limit') return { kind: 'checking_quota', videoId: event.videoId, gate: event.gate };
      return { kind: 'playing', videoId: event.videoId, limited: false, gate: event.gate, quota: null };
    case 'quota': {
      if (state.kind !== 'checking_quota' && !(state.kind === 'playing' && state.limited)) return state;
      const video = event.quota.video;
      if (video && !video.allowed) {
        const reason = video.state === 'resume_tomorrow' ? 'resume_tomorrow' : 'quota';
        return blocked(event.videoId, reason, { gate: state.gate, quota: event.quota });
      }
      return { kind: 'playing', videoId: event.videoId, limited: true, gate: state.gate, quota: event.quota };
    }
    case 'failure':
      if (state.kind === 'blocked' && state.reason !== 'timeout') return state;
      if (state.kind === 'playing' && !state.limited) return state; // LIBRE needs nothing more
      return blocked(event.videoId, event.reason, { detail: event.detail ?? null, gate: 'gate' in state ? state.gate : null });
  }
}

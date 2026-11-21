// window.postMessage protocol between content.ts (isolated world) and
// page-bridge.ts (page / MAIN world).
import type { PlayerResponse } from './extract/player-types';
import type { TrackKind, TranscriptStatus } from './types';

export const BRIDGE_TAG = 'brain-smooch-desktop';

export type PlayerSource = 'movie_player' | 'shorts_player' | 'intercepted' | 'initial';
export type CaptionVia = 'direct' | 'pot-reuse' | 'captured' | 'player-trigger';

export interface CaptionAttempt {
  method: CaptionVia;
  httpStatus: number | null;
  bytes: number;
  error?: string;
}

export interface CaptionResult {
  status: TranscriptStatus;
  track: { languageCode: string; kind: TrackKind } | null;
  json3: string | null;
  via: CaptionVia | null;
  attempts: CaptionAttempt[];
}

export interface Snapshot {
  videoId: string;
  source: PlayerSource;
  playerResponse: PlayerResponse;
  /** Game title (gaming videos), from `/youtubei/v1/next` or ytInitialData; best effort. */
  game: string | null;
  captions: CaptionResult;
}

export type ToBridge = { tag: typeof BRIDGE_TAG; dir: 'to-page'; type: 'snapshot-request'; requestId: string; videoId: string };

export type FromBridge =
  | { tag: typeof BRIDGE_TAG; dir: 'from-page'; type: 'snapshot'; requestId: string; snapshot: Snapshot }
  | { tag: typeof BRIDGE_TAG; dir: 'from-page'; type: 'snapshot-error'; requestId: string; error: string }
  | { tag: typeof BRIDGE_TAG; dir: 'from-page'; type: 'navigated'; href: string };

export function isFromBridge(data: unknown): data is FromBridge {
  return !!data && typeof data === 'object' && (data as FromBridge).tag === BRIDGE_TAG && (data as FromBridge).dir === 'from-page';
}

export function isToBridge(data: unknown): data is ToBridge {
  return !!data && typeof data === 'object' && (data as ToBridge).tag === BRIDGE_TAG && (data as ToBridge).dir === 'to-page';
}

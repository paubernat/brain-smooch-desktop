// Real player responses (trimmed), captured 2026-11-21 from the public watch /
// shorts HTML pages (ytInitialPlayerResponse). See SPIKE.md.
import type { PlayerResponse } from '../src/extract/player-types';
import shortChords from './fixtures/player-short-ib6nIB-fbNE.json';
import shortMinor67 from './fixtures/player-short-oyxs-4jk0Tg.json';
import watchNeural from './fixtures/player-watch-aircAruvnKk.json';
import json3Asr from './fixtures/captions-asr.json3.json';
import json3Manual from './fixtures/captions-manual.json3.json';
import playerLive from './fixtures/player-live-rFZHOHl-L8A.json';
import playerUpcoming from './fixtures/player-upcoming-eKhoBmNB6Tg.json';
import playerPastLive from './fixtures/player-pastlive-jfKfPfyJRdk.json';
import nextAiEn from './fixtures/next-ai-3wHHSYxka74.en.json';
import nextAiEs from './fixtures/next-ai-3wHHSYxka74.es.json';
import nextAutoDub from './fixtures/next-autodub-402VxfR7fRQ.en.json';
import nextNone from './fixtures/next-none-2BthJJ_zJgU.es.json';
import reelItemAi from './fixtures/reel-item-ai-cZ44YIQXShY.es.json';
import reelInitialAutoDub from './fixtures/reel-initial-autodub-6Y-3qIzFlLk.en.json';
import reelSequence from './fixtures/reel-sequence-6Y-3qIzFlLk.en.json';

export const SHORT_CHORDS = shortChords as PlayerResponse; // ib6nIB-fbNE, Short, en asr only
export const SHORT_MINOR67 = shortMinor67 as PlayerResponse; // oyxs-4jk0Tg, Short, no keywords
export const WATCH_NEURAL = watchNeural as PlayerResponse; // aircAruvnKk, long, chapters, 31 tracks
// Live states, real (2026-11-21, trimmed ytInitialPlayerResponse).
export const LIVE_NOW = playerLive as PlayerResponse; // rFZHOHl-L8A, 24/7 lofi stream
export const LIVE_UPCOMING = playerUpcoming as PlayerResponse; // eKhoBmNB6Tg, scheduled stream
export const LIVE_PAST = playerPastLive as PlayerResponse; // jfKfPfyJRdk, ended 24/7 stream (VOD)

// "How this was made" section, real (2026-11-21, trimmed ytInitialData / innertube responses).
export const NEXT_AI_EN: unknown = nextAiEn; // 3wHHSYxka74 watch ytInitialData, "Made with AI"
export const NEXT_AI_ES: unknown = nextAiEs; // 3wHHSYxka74 /youtubei/v1/next hl=es, "Creado con IA"
export const NEXT_AUTODUB: unknown = nextAutoDub; // 402VxfR7fRQ, "Auto-dubbed" (not an AI label)
export const NEXT_NONE: unknown = nextNone; // 2BthJJ_zJgU, Suno song WITHOUT disclosure
export const REEL_ITEM_AI: unknown = reelItemAi; // cZ44YIQXShY /youtubei/v1/reel/reel_item_watch hl=es
export const REEL_INITIAL_AUTODUB: unknown = reelInitialAutoDub; // 6Y-3qIzFlLk /shorts ytInitialData (no videoId inside)
export const REEL_SEQUENCE: unknown = reelSequence; // ytInitialReelWatchSequenceResponse of /shorts/6Y-3qIzFlLk

export const JSON3_ASR = JSON.stringify(json3Asr); // synthetic
export const JSON3_MANUAL = JSON.stringify(json3Manual); // synthetic

/** Deep copy so tests can mutate freely. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

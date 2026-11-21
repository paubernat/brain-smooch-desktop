// Real player responses (trimmed), captured 2026-11-21 from the public watch /
// shorts HTML pages (ytInitialPlayerResponse). See SPIKE.md.
import type { PlayerResponse } from '../src/extract/player-types';
import shortChords from './fixtures/player-short-ib6nIB-fbNE.json';
import shortMinor67 from './fixtures/player-short-oyxs-4jk0Tg.json';
import watchNeural from './fixtures/player-watch-aircAruvnKk.json';
import json3Asr from './fixtures/captions-asr.json3.json';
import json3Manual from './fixtures/captions-manual.json3.json';

export const SHORT_CHORDS = shortChords as PlayerResponse; // ib6nIB-fbNE, Short, en asr only
export const SHORT_MINOR67 = shortMinor67 as PlayerResponse; // oyxs-4jk0Tg, Short, no keywords
export const WATCH_NEURAL = watchNeural as PlayerResponse; // aircAruvnKk, long, chapters, 31 tracks
export const JSON3_ASR = JSON.stringify(json3Asr); // synthetic
export const JSON3_MANUAL = JSON.stringify(json3Manual); // synthetic

/** Deep copy so tests can mutate freely. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

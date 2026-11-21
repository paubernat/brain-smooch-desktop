// L3: caption track selection and json3 parsing. Pure functions, no DOM / network.
// The download itself happens in page-bridge.ts (page context).
import type { TrackKind, Transcript, TranscriptSegment, TranscriptStatus } from '../types';
import type { PlayerResponse } from './player-types';

export interface Track {
  baseUrl: string;
  languageCode: string;
  kind: TrackKind;
}

export const FALLBACK_LANGUAGES = ['es', 'en'] as const;

export function listCaptionTracks(pr: PlayerResponse): Track[] {
  const raw = pr.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const tracks: Track[] = [];
  for (const t of raw) {
    if (!t.baseUrl || !t.languageCode) continue;
    tracks.push({ baseUrl: t.baseUrl, languageCode: t.languageCode, kind: t.kind === 'asr' ? 'asr' : 'manual' });
  }
  return tracks;
}

/**
 * Spoken language of the video. The auto-generated (asr) track is produced
 * from the audio, so its language is the best signal; otherwise use the
 * default caption track of the default audio track.
 */
export function detectVideoLanguage(pr: PlayerResponse): string | null {
  const renderer = pr.captions?.playerCaptionsTracklistRenderer;
  const raw = renderer?.captionTracks ?? [];
  const asr = raw.find((t) => t.kind === 'asr' && t.languageCode);
  if (asr?.languageCode) return asr.languageCode;
  const audio = renderer?.audioTracks?.[renderer.defaultAudioTrackIndex ?? 0];
  const idx = audio?.defaultCaptionTrackIndex;
  if (idx !== undefined) return raw[idx]?.languageCode ?? null;
  return null;
}

/**
 * Preference: video language, then es, then en; within each language a manual
 * track beats an auto-generated one. If nothing matches, first manual track,
 * then any track.
 */
export function selectCaptionTrack(pr: PlayerResponse): Track | null {
  const tracks = listCaptionTracks(pr);
  if (tracks.length === 0) return null;
  const videoLang = detectVideoLanguage(pr);
  const prefs = [videoLang, ...FALLBACK_LANGUAGES].filter((l): l is string => !!l);
  for (const lang of prefs) {
    const sameLang = tracks.filter((t) => baseLang(t.languageCode) === baseLang(lang));
    const pick = sameLang.find((t) => t.kind === 'manual') ?? sameLang[0];
    if (pick) return pick;
  }
  return tracks.find((t) => t.kind === 'manual') ?? tracks[0] ?? null;
}

function baseLang(code: string): string {
  return code.toLowerCase().split(/[-_]/)[0] ?? code;
}

export function json3Url(baseUrl: string): string {
  const url = new URL(baseUrl, 'https://www.youtube.com');
  url.searchParams.set('fmt', 'json3');
  return url.toString();
}

/** Query params the player adds to its own timedtext requests (PO token etc). */
const PLAYER_TOKEN_PARAMS = ['pot', 'potc', 'c', 'cver', 'cplayer', 'cos', 'cosver', 'cbr', 'cbrver'];

/**
 * Rebuild a track URL reusing the PO token (`pot`) and client params from a
 * timedtext request captured from the player for the same video.
 * Returns null if the captured URL carries no `pot`.
 */
export function withPlayerToken(baseUrl: string, capturedUrl: string): string | null {
  const captured = new URL(capturedUrl, 'https://www.youtube.com');
  if (!captured.searchParams.get('pot')) return null;
  const url = new URL(json3Url(baseUrl));
  for (const key of PLAYER_TOKEN_PARAMS) {
    const v = captured.searchParams.get(key);
    if (v !== null) url.searchParams.set(key, v);
  }
  return url.toString();
}

/** Extract `v` and `lang` from a timedtext URL. */
export function timedtextKey(url: string): { videoId: string; lang: string | null } | null {
  try {
    const u = new URL(url, 'https://www.youtube.com');
    if (!u.pathname.includes('/api/timedtext')) return null;
    const v = u.searchParams.get('v');
    return v ? { videoId: v, lang: u.searchParams.get('lang') ?? u.searchParams.get('tlang') } : null;
  } catch {
    return null;
  }
}

interface Json3Seg {
  utf8?: string;
}
interface Json3Event {
  tStartMs?: number;
  dDurationMs?: number;
  aAppend?: number;
  segs?: Json3Seg[];
}

/**
 * json3 -> segments. Each event with text becomes one segment; whitespace is
 * collapsed; empty / newline-only events (ASR "append" events) are skipped.
 * Throws on malformed JSON so callers can report `blocked`.
 */
export function parseJson3(raw: string | object): TranscriptSegment[] {
  const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { events?: Json3Event[] };
  const events = Array.isArray(data.events) ? data.events : [];
  const segments: TranscriptSegment[] = [];
  for (const ev of events) {
    if (!ev.segs) continue;
    const text = ev.segs
      .map((s) => s.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    segments.push({ start_s: Math.round(ev.tStartMs ?? 0) / 1000, text });
  }
  return segments;
}

/** Assemble the contract `transcript` object. */
export function buildTranscript(
  track: Track | null,
  status: TranscriptStatus,
  json3: string | null,
): Transcript {
  if (!track || status !== 'ok' || !json3) {
    return { status: status === 'ok' ? 'blocked' : status, language: track?.languageCode ?? null, kind: track?.kind ?? null, segments: [] };
  }
  let segments: TranscriptSegment[];
  try {
    segments = parseJson3(json3);
  } catch {
    return { status: 'blocked', language: track.languageCode, kind: track.kind, segments: [] };
  }
  if (segments.length === 0) {
    return { status: 'blocked', language: track.languageCode, kind: track.kind, segments: [] };
  }
  return { status: 'ok', language: track.languageCode, kind: track.kind, segments };
}

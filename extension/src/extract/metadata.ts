// L1: metadata from the player response. Pure functions, no DOM / network.
import type { AiDisclosure, Chapter, Metadata } from '../types';
import { UNKNOWN_DISCLOSURE } from './ai-disclosure';
import { extractLive } from './live';
import type { PlayerResponse } from './player-types';

/** Upper bound for Shorts duration (YouTube allows Shorts up to 3 minutes since Oct 2024). */
export const SHORT_MAX_SECONDS = 180;

export interface MetadataContext {
  /** True when the page URL is /shorts/<id>. */
  isShortUrl: boolean;
  /** Associated game (gaming videos), best effort, see extractGame(). */
  game?: string | null;
  /** Creator-disclosed AI label from the next/reel data (see ai-disclosure.ts). */
  aiDisclosure?: AiDisclosure | null;
}

export function extractMetadata(pr: PlayerResponse, ctx: MetadataContext): Metadata {
  const vd = pr.videoDetails ?? {};
  const mf = pr.microformat?.playerMicroformatRenderer ?? {};
  const description = vd.shortDescription ?? '';
  const duration = toInt(vd.lengthSeconds);

  return {
    title: vd.title ?? '',
    description_raw: description,
    keywords: Array.isArray(vd.keywords) ? vd.keywords.filter((k) => typeof k === 'string') : [],
    category: mf.category ?? null,
    duration_s: duration,
    is_short: isShort(pr, ctx.isShortUrl),
    chapters: parseChapters(description, duration),
    channel_id: vd.channelId ?? mf.externalChannelId ?? '',
    channel_name: vd.author ?? mf.ownerChannelName ?? '',
    publish_date: toDate(mf.publishDate ?? mf.uploadDate),
    is_family_safe: typeof mf.isFamilySafe === 'boolean' ? mf.isFamilySafe : null,
    game: ctx.game ?? null,
    ai_disclosure: { ...(ctx.aiDisclosure ?? UNKNOWN_DISCLOSURE) },
    live: extractLive(pr),
  };
}

/**
 * is_short criterion (first match wins):
 *  1. The page URL is /shorts/<id>  -> true.
 *  2. microformat.canonicalUrl contains "/shorts/" -> true. Observed on real
 *     responses: Shorts have canonicalUrl https://www.youtube.com/shorts/<id>,
 *     regular videos /watch?v=<id>, even when the Short is opened via /watch.
 *  3. Fallback heuristic: duration <= 180 s AND vertical video (some stream
 *     format with height > width).
 * `isShortsEligible` is NOT used on its own: it only says the video could be
 * shown in the Shorts feed, not that it is a Short.
 */
export function isShort(pr: PlayerResponse, isShortUrl: boolean): boolean {
  if (isShortUrl) return true;
  const canonical = pr.microformat?.playerMicroformatRenderer?.canonicalUrl ?? '';
  if (canonical.includes('/shorts/')) return true;
  const duration = toInt(pr.videoDetails?.lengthSeconds);
  return duration > 0 && duration <= SHORT_MAX_SECONDS && isVertical(pr);
}

export function isVertical(pr: PlayerResponse): boolean {
  const formats = [...(pr.streamingData?.formats ?? []), ...(pr.streamingData?.adaptiveFormats ?? [])];
  const sized = formats.find((f) => (f.width ?? 0) > 0 && (f.height ?? 0) > 0);
  return sized ? (sized.height ?? 0) > (sized.width ?? 0) : false;
}

// "0:00 Intro", "1:02:03 - Part", "(12:30) Title", "12:30 | Title"
const CHAPTER_LINE = /^\s*[([]?((?:\d{1,2}:)?\d{1,2}:\d{2})[)\]]?\s*(?:[-–—:|.]\s*)?(.+?)\s*$/;

/**
 * Chapters from description lines that START with a timestamp.
 * Kept only if there are >= 2 lines and their times are strictly ascending
 * (otherwise they are likely song lists or comments, not chapters).
 * Lines with a timestamp in the middle ("Correction 14:45 - ...") are ignored.
 */
export function parseChapters(description: string, durationS = 0): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const m = CHAPTER_LINE.exec(line);
    if (!m || !m[1] || !m[2]) continue;
    const start = timestampToSeconds(m[1]);
    const title = m[2].trim();
    if (start === null || !title) continue;
    chapters.push({ start_s: start, title });
  }
  if (chapters.length < 2) return [];
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i]!.start_s <= chapters[i - 1]!.start_s) return [];
  }
  if (durationS > 0 && chapters[chapters.length - 1]!.start_s > durationS) return [];
  return chapters;
}

export function timestampToSeconds(ts: string): number | null {
  const parts = ts.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return null;
  if (parts.slice(1).some((p) => p >= 60)) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/**
 * Best-effort game title for gaming videos. Input: a watch "next" response
 * (`/youtubei/v1/next`) or `ytInitialData`. YouTube shows the game as a
 * `richMetadataRenderer` with style RICH_METADATA_RENDERER_STYLE_BOX_ART.
 */
export function extractGame(nextData: unknown): string | null {
  const found = findRichMetadataBoxArt(nextData, 0);
  return found ? textOf(found['title']) : null;
}

function findRichMetadataBoxArt(node: unknown, depth: number): Record<string, unknown> | null {
  if (depth > 40 || node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const r = findRichMetadataBoxArt(item, depth + 1);
      if (r) return r;
    }
    return null;
  }
  const obj = node as Record<string, unknown>;
  const rich = obj['richMetadataRenderer'] as Record<string, unknown> | undefined;
  if (rich && rich['style'] === 'RICH_METADATA_RENDERER_STYLE_BOX_ART') return rich;
  for (const value of Object.values(obj)) {
    const r = findRichMetadataBoxArt(value, depth + 1);
    if (r) return r;
  }
  return null;
}

function textOf(t: unknown): string | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as { simpleText?: string; runs?: { text?: string }[] };
  if (typeof o.simpleText === 'string') return o.simpleText;
  if (Array.isArray(o.runs)) return o.runs.map((r) => r.text ?? '').join('') || null;
  return null;
}

function toInt(v: string | number | undefined): number {
  const n = typeof v === 'number' ? v : parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toDate(v: string | undefined): string | null {
  return v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

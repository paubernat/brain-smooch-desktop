// L4: storyboard spec parsing -> sprite URLs. Pure functions, no DOM / network.
//
// Spec format (playerStoryboardSpecRenderer.spec), observed on real responses:
//   <template URL>|<level 0>|<level 1>|...
// template: https://i.ytimg.com/sb/<id>/storyboard3_L$L/$N.jpg?sqp=...
// level:    width#height#frame_count#columns#rows#interval_ms#name#sigh
//   e.g.    320#180#113#3#3#10000#M$M#rs$AOn4CLC...
// $L = level index (0-based, position after the template), $N = level name,
// $M (inside the name) = sprite sheet index. Level 0 is usually a single
// "default" image with interval 0. Each sprite URL gets `&sigh=<sigh>`.
import type { Storyboard } from '../types';
import type { PlayerResponse } from './player-types';

export interface StoryboardLevel {
  index: number;
  width: number;
  height: number;
  frameCount: number;
  columns: number;
  rows: number;
  intervalMs: number;
  name: string;
  sigh: string;
}

export interface ParsedSpec {
  template: string;
  levels: StoryboardLevel[];
}

export function parseStoryboardSpec(spec: string): ParsedSpec | null {
  const parts = spec.split('|');
  const template = parts.shift();
  if (!template || !/^https?:\/\//.test(template)) return null;
  const levels: StoryboardLevel[] = [];
  parts.forEach((raw, index) => {
    const f = raw.split('#');
    if (f.length < 8) return;
    const nums = f.slice(0, 6).map((x) => parseInt(x, 10));
    if (nums.some((n) => !Number.isFinite(n))) return;
    const [width, height, frameCount, columns, rows, intervalMs] = nums as [number, number, number, number, number, number];
    // The sigh could in theory contain '#'; join the remainder to be safe.
    levels.push({ index, width, height, frameCount, columns, rows, intervalMs, name: f[6]!, sigh: f.slice(7).join('#') });
  });
  return levels.length ? { template, levels } : null;
}

/** Highest resolution level (largest frame area); ties -> more frames. */
export function pickBestLevel(levels: StoryboardLevel[]): StoryboardLevel | null {
  const usable = levels.filter((l) => l.width > 0 && l.height > 0 && l.frameCount > 0 && l.columns > 0 && l.rows > 0);
  if (!usable.length) return null;
  return usable.reduce((best, l) => {
    const a = l.width * l.height;
    const b = best.width * best.height;
    return a > b || (a === b && l.frameCount > best.frameCount) ? l : best;
  });
}

export function spriteCount(level: StoryboardLevel): number {
  return Math.ceil(level.frameCount / (level.columns * level.rows));
}

export function spriteUrls(template: string, level: StoryboardLevel): string[] {
  const base = template.split('$L').join(String(level.index)).split('$N').join(level.name);
  const sep = base.includes('?') ? '&' : '?';
  const urls: string[] = [];
  const n = level.name.includes('$M') ? spriteCount(level) : 1;
  for (let m = 0; m < n; m++) {
    const url = base.split('$M').join(String(m));
    urls.push(level.sigh ? `${url}${sep}sigh=${level.sigh}` : url);
  }
  return urls;
}

/**
 * Thumbnail: largest entry of videoDetails.thumbnail.thumbnails (query
 * stripped), else the always-present hqdefault.jpg.
 */
export function pickThumbnail(pr: PlayerResponse, videoId: string): string {
  const thumbs = pr.videoDetails?.thumbnail?.thumbnails ?? [];
  const best = thumbs
    .filter((t) => t.url)
    .reduce<{ url?: string; width?: number; height?: number } | null>(
      (acc, t) => (!acc || (t.width ?? 0) * (t.height ?? 0) > (acc.width ?? 0) * (acc.height ?? 0) ? t : acc),
      null,
    );
  if (best?.url) return best.url.split('?')[0]!;
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Contract `storyboard` object, or null when there is no VOD spec
 * (live streams only have playerLiveStoryboardSpecRenderer; ignored here).
 */
export function buildStoryboard(pr: PlayerResponse, videoId: string): Storyboard | null {
  const spec = pr.storyboards?.playerStoryboardSpecRenderer?.spec;
  if (!spec) return null;
  const parsed = parseStoryboardSpec(spec);
  if (!parsed) return null;
  const level = pickBestLevel(parsed.levels);
  if (!level) return null;
  return {
    thumbnail_url: pickThumbnail(pr, videoId),
    level: {
      width: level.width,
      height: level.height,
      frame_count: level.frameCount,
      columns: level.columns,
      rows: level.rows,
      interval_ms: level.intervalMs,
    },
    sprite_urls: spriteUrls(parsed.template, level),
  };
}

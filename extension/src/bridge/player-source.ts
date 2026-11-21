// Finds the current player response for a videoId (page world).
// Order: live player elements (watch + Shorts) -> intercepted network
// responses -> window.ytInitialPlayerResponse. Every source is checked against
// the expected videoId, because after SPA navigation some sources are stale.
import { extractGame } from '../extract/metadata';
import type { PlayerResponse } from '../extract/player-types';
import type { PlayerSource } from '../bridge-protocol';
import { gameCache, playerCache } from './cache';

export interface YtPlayerElement extends HTMLElement {
  getPlayerResponse?: () => PlayerResponse | null | undefined;
  loadModule?: (name: string) => void;
  unloadModule?: (name: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  getOption?: (module: string, option: string) => unknown;
}

interface PageGlobals {
  ytInitialPlayerResponse?: PlayerResponse;
  ytInitialData?: { currentVideoEndpoint?: { watchEndpoint?: { videoId?: string } } };
}

export interface ResolvedPlayer {
  pr: PlayerResponse;
  source: PlayerSource;
  player: YtPlayerElement | null;
}

export function findPlayers(): { el: YtPlayerElement; source: PlayerSource }[] {
  const out: { el: YtPlayerElement; source: PlayerSource }[] = [];
  const seen = new Set<Element>();
  const add = (el: Element | null, source: PlayerSource) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    out.push({ el: el as YtPlayerElement, source });
  };
  // Active Short first (the Shorts feed keeps several renderers in the DOM).
  add(document.querySelector('ytd-reel-video-renderer[is-active] #shorts-player'), 'shorts_player');
  add(document.getElementById('shorts-player'), 'shorts_player');
  add(document.getElementById('movie_player'), 'movie_player');
  document.querySelectorAll('.html5-video-player').forEach((el) => add(el, 'movie_player'));
  return out;
}

function safePlayerResponse(el: YtPlayerElement): PlayerResponse | null {
  try {
    return typeof el.getPlayerResponse === 'function' ? (el.getPlayerResponse() ?? null) : null;
  } catch {
    return null;
  }
}

export function resolvePlayer(videoId: string): ResolvedPlayer | null {
  for (const { el, source } of findPlayers()) {
    const pr = safePlayerResponse(el);
    if (pr?.videoDetails?.videoId === videoId) return { pr, source, player: el };
  }
  const cached = playerCache.get(videoId);
  if (cached) return { pr: cached, source: 'intercepted', player: playerFor(videoId) };
  const initial = (window as unknown as PageGlobals).ytInitialPlayerResponse;
  if (initial?.videoDetails?.videoId === videoId) return { pr: initial, source: 'initial', player: playerFor(videoId) };
  return null;
}

/** The player element currently showing videoId (needed to trigger captions). */
export function playerFor(videoId: string): YtPlayerElement | null {
  for (const { el } of findPlayers()) {
    if (safePlayerResponse(el)?.videoDetails?.videoId === videoId) return el;
  }
  return null;
}

export async function waitForPlayer(videoId: string, timeoutMs: number): Promise<ResolvedPlayer | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = resolvePlayer(videoId);
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export function gameFor(videoId: string): string | null {
  if (gameCache.has(videoId)) return gameCache.get(videoId) ?? null;
  const data = (window as unknown as PageGlobals).ytInitialData;
  if (data?.currentVideoEndpoint?.watchEndpoint?.videoId === videoId) return extractGame(data);
  return null;
}

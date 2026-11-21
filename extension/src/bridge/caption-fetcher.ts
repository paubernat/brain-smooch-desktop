// Downloads captions from the page context (same-origin, page cookies).
// Strategy, in order (PLAN §6.4):
//  1. direct:         baseUrl + &fmt=json3
//  2. captured:       body of a json3 timedtext request the player already made
//  3. pot-reuse:      baseUrl + the `pot` token copied from a captured player request
//  4. player-trigger: ask the player to load the captions module so it makes its
//                     own timedtext request, capture it, then restore the state
// Observed 2026-11: (1) returns HTTP 200 with an EMPTY body without `pot`.
import type { CaptionAttempt, CaptionResult, CaptionVia } from '../bridge-protocol';
import { json3Url, selectCaptionTrack, withPlayerToken, type Track } from '../extract/captions';
import type { PlayerResponse } from '../extract/player-types';
import { timedtextCache, type CapturedTimedtext } from './cache';
import { debugLog } from './debug';
import { originalFetch } from './interceptor';
import type { YtPlayerElement } from './player-source';

const TRIGGER_WAIT_MS = 4000;

export function isTriggerEnabled(): boolean {
  try {
    return window.localStorage.getItem('bsd-caption-trigger') !== '0';
  } catch {
    return true;
  }
}

function looksLikeJson3(body: string): boolean {
  if (!body || body.length < 10) return false;
  try {
    const data = JSON.parse(body) as { events?: unknown[] };
    return Array.isArray(data.events) && data.events.length > 0;
  } catch {
    return false;
  }
}

async function tryUrl(url: string, method: CaptionVia, attempts: CaptionAttempt[]): Promise<string | null> {
  try {
    const res = await originalFetch(url, { credentials: 'include' });
    const body = await res.text();
    attempts.push({ method, httpStatus: res.status, bytes: body.length });
    return res.ok && looksLikeJson3(body) ? body : null;
  } catch (e) {
    attempts.push({ method, httpStatus: null, bytes: 0, error: String(e) });
    return null;
  }
}

function sameLang(a: string | null, b: string): boolean {
  return !!a && a.toLowerCase().split('-')[0] === b.toLowerCase().split('-')[0];
}

async function fromCaptured(videoId: string, track: Track, attempts: CaptionAttempt[]): Promise<{ body: string; via: CaptionVia } | null> {
  const captured: CapturedTimedtext[] = timedtextCache.get(videoId) ?? [];
  const direct = captured.find((c) => sameLang(c.lang, track.languageCode) && looksLikeJson3(c.body));
  if (direct) {
    attempts.push({ method: 'captured', httpStatus: 200, bytes: direct.body.length });
    return { body: direct.body, via: 'captured' };
  }
  for (const c of captured) {
    const url = withPlayerToken(track.baseUrl, c.url);
    if (!url) continue;
    const body = await tryUrl(url, 'pot-reuse', attempts);
    if (body) return { body, via: 'pot-reuse' };
  }
  return null;
}

async function triggerPlayerCaptions(player: YtPlayerElement, track: Track): Promise<() => void> {
  let wasOn = false;
  try {
    const current = player.getOption?.('captions', 'track') as { languageCode?: string } | undefined;
    wasOn = !!current?.languageCode;
  } catch {
    /* ignore */
  }
  try {
    player.loadModule?.('captions');
    player.setOption?.('captions', 'track', { languageCode: track.languageCode, kind: track.kind === 'asr' ? 'asr' : undefined });
  } catch (e) {
    debugLog('caption trigger failed', e);
  }
  return () => {
    if (wasOn) return;
    try {
      player.unloadModule?.('captions');
    } catch {
      /* ignore */
    }
  };
}

export async function fetchCaptions(pr: PlayerResponse, videoId: string, player: YtPlayerElement | null): Promise<CaptionResult> {
  const track = selectCaptionTrack(pr);
  const attempts: CaptionAttempt[] = [];
  if (!track) return { status: 'none', track: null, json3: null, via: null, attempts };
  const result = (json3: string, via: CaptionVia): CaptionResult => ({
    status: 'ok',
    track: { languageCode: track.languageCode, kind: track.kind },
    json3,
    via,
    attempts,
  });

  const direct = await tryUrl(json3Url(track.baseUrl), 'direct', attempts);
  if (direct) return result(direct, 'direct');

  const captured = await fromCaptured(videoId, track, attempts);
  if (captured) return result(captured.body, captured.via);

  if (player && isTriggerEnabled()) {
    const restore = await triggerPlayerCaptions(player, track);
    const deadline = Date.now() + TRIGGER_WAIT_MS;
    while (Date.now() < deadline && !(timedtextCache.get(videoId)?.length)) {
      await new Promise((r) => setTimeout(r, 250));
    }
    restore();
    const afterTrigger = await fromCaptured(videoId, track, attempts);
    if (afterTrigger) return result(afterTrigger.body, afterTrigger.via === 'captured' ? 'player-trigger' : afterTrigger.via);
  }

  return { status: 'blocked', track: { languageCode: track.languageCode, kind: track.kind }, json3: null, via: null, attempts };
}

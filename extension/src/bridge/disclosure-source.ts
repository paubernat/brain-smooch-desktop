// Finds the creator-disclosed AI label for a videoId (page world).
// Order: intercepted /youtubei/v1/next and /reel/* responses (fresh after SPA
// navigation) -> ytInitialData of the page the tab was loaded with (stale
// after SPA navigation, so it is only trusted for the initial video) ->
// ytInitialReelWatchSequenceResponse (prefetched next Shorts).
import { aiDisclosuresFromResponse, parseMaybeJson, UNKNOWN_DISCLOSURE } from '../extract/ai-disclosure';
import type { AiDisclosure } from '../types';
import { parseVideoUrl, type VideoRef } from '../url';
import { disclosureCache } from './cache';

interface PageGlobals {
  ytInitialData?: unknown;
  ytInitialReelWatchSequenceResponse?: unknown;
}

const POLL_MS = 250;

/** Video of the URL the document was loaded with (ytInitialData belongs to it). */
let initialRef: VideoRef | null = null;

export function rememberInitialVideo(href: string): void {
  initialRef = parseVideoUrl(href);
}

function fromInitialData(videoId: string): AiDisclosure | null {
  const g = window as unknown as PageGlobals;
  if (initialRef?.videoId === videoId) {
    const kind = initialRef.isShortUrl ? 'reel' : 'next';
    const found = aiDisclosuresFromResponse(g.ytInitialData, kind, videoId).get(videoId);
    if (found) return found;
  }
  return aiDisclosuresFromResponse(parseMaybeJson(g.ytInitialReelWatchSequenceResponse), 'reel').get(videoId) ?? null;
}

export function disclosureFor(videoId: string): AiDisclosure | null {
  return disclosureCache.get(videoId) ?? fromInitialData(videoId);
}

/** Waits a little for the next/reel response (it may land after the player response). */
export async function waitForDisclosure(videoId: string, timeoutMs: number): Promise<AiDisclosure> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = disclosureFor(videoId);
    if (found) return found;
    if (Date.now() >= deadline) return { ...UNKNOWN_DISCLOSURE };
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

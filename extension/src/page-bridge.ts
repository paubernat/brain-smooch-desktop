// Page-world script (manifest content script with "world": "MAIN", run_at
// document_start). It is the only code that can see YouTube's JS objects
// (ytInitialPlayerResponse, movie_player.getPlayerResponse()) and fetch
// captions with the page's own origin/cookies. It answers snapshot requests
// from content.ts over window.postMessage.
//
// Why MAIN-world content script instead of a <script src> tag injected by
// content.ts or window.wrappedJSObject: it runs at document_start, before
// YouTube's own code, so the fetch/XHR wrappers see the very first
// /youtubei/v1/player and timedtext requests (needed for Shorts and the `pot`
// fallback); it needs no web_accessible_resources and is immune to the page CSP.
// Requires Firefox >= 128 (manifest asks 142 for data_collection_permissions).
import { BRIDGE_TAG, isToBridge, type FromBridge, type Snapshot } from './bridge-protocol';
import { trimPlayerResponse } from './extract/player-types';
import { fetchCaptions } from './bridge/caption-fetcher';
import { debugLog } from './bridge/debug';
import { rememberInitialVideo, waitForDisclosure } from './bridge/disclosure-source';
import { installInterceptor } from './bridge/interceptor';
import { gameFor, waitForPlayer } from './bridge/player-source';

const PLAYER_TIMEOUT_MS = 12000;
/** Extra wait for the next/reel response after the player response and captions. */
const DISCLOSURE_TIMEOUT_MS = 2000;

function post(msg: FromBridge): void {
  window.postMessage(msg, window.location.origin);
}

async function buildSnapshot(videoId: string): Promise<Snapshot> {
  const found = await waitForPlayer(videoId, PLAYER_TIMEOUT_MS);
  if (!found) throw new Error(`player response for ${videoId} not found`);
  debugLog('player response source:', found.source);
  const captions = await fetchCaptions(found.pr, videoId, found.player);
  const aiDisclosure = await waitForDisclosure(videoId, DISCLOSURE_TIMEOUT_MS);
  debugLog('ai disclosure for', videoId, aiDisclosure);
  return {
    videoId,
    source: found.source,
    playerResponse: trimPlayerResponse(found.pr),
    game: gameFor(videoId),
    aiDisclosure,
    captions,
  };
}

function onMessage(event: MessageEvent): void {
  if (event.source !== window || !isToBridge(event.data)) return;
  const { requestId, videoId } = event.data;
  buildSnapshot(videoId)
    .then((snapshot) => post({ tag: BRIDGE_TAG, dir: 'from-page', type: 'snapshot', requestId, snapshot }))
    .catch((e: unknown) => post({ tag: BRIDGE_TAG, dir: 'from-page', type: 'snapshot-error', requestId, error: String(e) }));
}

function main(): void {
  const flag = '__brainSmoochBridge';
  const w = window as unknown as Record<string, unknown>;
  if (w[flag]) return;
  w[flag] = true;

  rememberInitialVideo(location.href);
  installInterceptor();
  window.addEventListener('message', onMessage);
  // SPA navigation: YouTube fires these on document after each route change.
  for (const type of ['yt-navigate-finish', 'yt-page-data-updated']) {
    document.addEventListener(type, () => post({ tag: BRIDGE_TAG, dir: 'from-page', type: 'navigated', href: location.href }));
  }
}

main();

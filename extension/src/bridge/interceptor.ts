// Wraps window.fetch and XMLHttpRequest (page world) to observe YouTube's own
// API responses. Nothing is modified: responses are cloned and read on the side.
import { timedtextKey } from '../extract/captions';
import { extractGame } from '../extract/metadata';
import type { PlayerResponse } from '../extract/player-types';
import { addTimedtext, gameCache, playerCache } from './cache';
import { debugLog } from './debug';

/** Unwrapped fetch, used by the bridge's own requests. */
export const originalFetch: typeof window.fetch = window.fetch.bind(window);

type Kind = 'player' | 'reel' | 'next' | 'timedtext';

function classify(url: string): Kind | null {
  if (url.includes('/youtubei/v1/player')) return 'player';
  if (url.includes('/youtubei/v1/reel/')) return 'reel';
  if (url.includes('/youtubei/v1/next')) return 'next';
  if (url.includes('/api/timedtext')) return 'timedtext';
  return null;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Bounded search for embedded player responses (reel responses nest them). */
function collectPlayerResponses(node: unknown, out: PlayerResponse[], depth = 0): void {
  if (depth > 8 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectPlayerResponses(item, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const details = obj['videoDetails'] as { videoId?: unknown } | undefined;
  if (details && typeof details.videoId === 'string' && obj['playabilityStatus']) {
    out.push(obj as PlayerResponse);
    return;
  }
  for (const value of Object.values(obj)) collectPlayerResponses(value, out, depth + 1);
}

export function handleResponse(kind: Kind, url: string, body: string): void {
  if (!body) return;
  if (kind === 'timedtext') {
    const key = timedtextKey(url);
    if (key) {
      addTimedtext(key.videoId, { url, body, lang: key.lang });
      debugLog('captured player timedtext', key, body.length, 'bytes');
    }
    return;
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return;
  }
  if (kind === 'next') {
    const vid = (json as { currentVideoEndpoint?: { watchEndpoint?: { videoId?: string } } }).currentVideoEndpoint?.watchEndpoint?.videoId;
    if (vid) gameCache.set(vid, extractGame(json));
    return;
  }
  const found: PlayerResponse[] = [];
  collectPlayerResponses(json, found);
  for (const pr of found) {
    const vid = pr.videoDetails?.videoId;
    if (vid) {
      playerCache.set(vid, pr);
      debugLog('intercepted player response', kind, vid);
    }
  }
}

export function installInterceptor(): void {
  const wrappedFetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const response = await originalFetch(input, init);
    try {
      const url = urlOf(input);
      const kind = classify(url);
      if (kind && response.ok) {
        response
          .clone()
          .text()
          .then((body) => handleResponse(kind, url, body))
          .catch(() => undefined);
      }
    } catch {
      /* never break the page */
    }
    return response;
  };
  window.fetch = wrappedFetch as typeof window.fetch;

  const xhrUrls = new WeakMap<XMLHttpRequest, string>();
  const proto = XMLHttpRequest.prototype;
  const origOpen = proto.open;
  const origSend = proto.send;

  proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
    try {
      xhrUrls.set(this, String(url));
    } catch {
      /* ignore */
    }
    return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof proto.open;

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const url = xhrUrls.get(this);
    const kind = url ? classify(url) : null;
    if (url && kind) {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          const text =
            this.responseType === '' || this.responseType === 'text'
              ? this.responseText
              : this.responseType === 'json'
                ? JSON.stringify(this.response)
                : '';
          handleResponse(kind, this.responseURL || url, text);
        } catch {
          /* ignore */
        }
      });
    }
    return origSend.call(this, body);
  };
}

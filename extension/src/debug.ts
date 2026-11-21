// Spike / debug mode (content script).
// Enable with either:
//   - page console on youtube.com: localStorage.setItem('bsd-debug', '1')
//   - extension storage: browser.storage.local.set({ debug: true })
// The storage flag is mirrored into localStorage so page-bridge.js logs too.
import type { Snapshot } from './bridge-protocol';
import { listCaptionTracks } from './extract/captions';
import type { FichaPayload } from './types';

let enabled = false;

export async function initDebug(): Promise<void> {
  try {
    enabled = window.localStorage.getItem('bsd-debug') === '1';
  } catch {
    enabled = false;
  }
  try {
    const { debug } = await browser.storage.local.get('debug');
    if (debug === true) {
      enabled = true;
      window.localStorage.setItem('bsd-debug', '1');
    }
  } catch {
    /* ignore */
  }
}

export function isDebug(): boolean {
  return enabled;
}

export function debugLog(...args: unknown[]): void {
  if (enabled) console.log('[bsd]', ...args);
}

/** Spike dump: L1, caption tracks + download attempts, storyboard spec. */
export function dumpSpike(snapshot: Snapshot, ficha: FichaPayload): void {
  if (!enabled) return;
  const pr = snapshot.playerResponse;
  console.groupCollapsed(`[bsd] ${ficha.video_id} — ${ficha.metadata.title} (source: ${snapshot.source})`);
  console.log('L1 metadata', ficha.metadata);
  console.table(listCaptionTracks(pr).map((t) => ({ lang: t.languageCode, kind: t.kind })));
  console.log('L3 selected track', snapshot.captions.track, 'status', snapshot.captions.status, 'via', snapshot.captions.via);
  console.table(snapshot.captions.attempts);
  console.log('L3 segments', ficha.transcript.segments.length, ficha.transcript.segments.slice(0, 5));
  console.log('L4 spec', pr.storyboards?.playerStoryboardSpecRenderer?.spec ?? '(none)');
  console.log('L4 storyboard', ficha.storyboard);
  console.groupEnd();
}

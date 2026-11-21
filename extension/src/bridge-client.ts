// Content-script side of the postMessage protocol with page-bridge.ts.
import { BRIDGE_TAG, isFromBridge, type Snapshot } from './bridge-protocol';

const pending = new Map<string, { resolve: (s: Snapshot) => void; reject: (e: Error) => void; timer: number }>();
const navigationListeners = new Set<(href: string) => void>();
let listening = false;

function ensureListener(): void {
  if (listening) return;
  listening = true;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window || !isFromBridge(event.data)) return;
    const msg = event.data;
    if (msg.type === 'navigated') {
      navigationListeners.forEach((cb) => cb(msg.href));
      return;
    }
    const entry = pending.get(msg.requestId);
    if (!entry) return;
    pending.delete(msg.requestId);
    window.clearTimeout(entry.timer);
    if (msg.type === 'snapshot') entry.resolve(msg.snapshot);
    else entry.reject(new Error(msg.error));
  });
}

export function onBridgeNavigation(cb: (href: string) => void): void {
  ensureListener();
  navigationListeners.add(cb);
}

/** Ask the page bridge for player data + captions of videoId. */
export function requestSnapshot(videoId: string, timeoutMs = 30000): Promise<Snapshot> {
  ensureListener();
  const requestId = `${videoId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<Snapshot>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('page bridge did not answer (is page-bridge.js loaded?)'));
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timer });
    window.postMessage({ tag: BRIDGE_TAG, dir: 'to-page', type: 'snapshot-request', requestId, videoId }, window.location.origin);
  });
}

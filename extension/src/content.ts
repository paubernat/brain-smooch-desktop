// Content script (isolated world): detects the current video, asks the page
// bridge for its data, builds the ficha, POSTs it to the service (via the
// background script) and drives the label panel.
import { api } from './api';
import { onBridgeNavigation, requestSnapshot } from './bridge-client';
import { debugLog, dumpSpike, initDebug } from './debug';
import { buildFicha } from './extract/ficha';
import type { FichaPayload, FichaResponse, Label } from './types';
import { LabelPanel } from './ui/label-panel';
import { parseVideoUrl, type VideoRef } from './url';

const URL_POLL_MS = 1000;
const LEVEL_POLL_MS = 3000;
const LEVEL_POLL_MAX = 10;

let currentVideoId: string | null = null;
let generation = 0;
let lastFicha: FichaPayload | null = null;

const panel = new LabelPanel({
  onLabel: (label, reason) => void submitLabel(label, reason),
  onRetry: () => {
    const ref = parseVideoUrl(location.href);
    if (ref) void processVideo(ref);
  },
});

function applyFicha(ficha: FichaResponse): void {
  panel.setLevels(ficha.levels);
  panel.setLabel(ficha.label);
}

async function processVideo(ref: VideoRef): Promise<void> {
  const gen = ++generation;
  const stale = () => gen !== generation;
  currentVideoId = ref.videoId;
  lastFicha = null;
  panel.mount();
  panel.setVideo(ref.videoId, '');
  panel.setEnabled(false);
  panel.setLevels({});
  panel.setBusy(true);
  panel.setStatus('leyendo vídeo…');

  // Existing label, if any, shown as soon as possible.
  void api.getFicha(ref.videoId).then((res) => {
    if (!stale() && res.ok) applyFicha(res.data);
  });

  try {
    const snapshot = await requestSnapshot(ref.videoId);
    if (stale()) return;
    const ficha = buildFicha(snapshot, ref);
    lastFicha = ficha;
    dumpSpike(snapshot, ficha);
    panel.setVideo(ref.videoId, ficha.metadata.title);
    panel.setLevels({ L1: 'ok', L3: ficha.transcript.status, L4: ficha.storyboard ? 'pending' : 'none' });

    panel.setStatus('guardando ficha…');
    const res = await api.postFicha(ficha);
    if (stale()) return;
    if (!res.ok) {
      panel.setStatus(`servicio: ${res.error}`, 'error', true);
      return;
    }
    applyFicha(res.data);
    panel.setEnabled(true);
    panel.setStatus('ficha guardada', 'ok');
    void pollLevels(ref.videoId, gen);
  } catch (e) {
    if (!stale()) panel.setStatus(`extracción: ${String(e)}`, 'error', true);
    debugLog('extraction failed', e);
  } finally {
    if (!stale()) panel.setBusy(false);
  }
}

/** L2/L4 are completed asynchronously by the service; refresh their status. */
async function pollLevels(videoId: string, gen: number): Promise<void> {
  for (let i = 0; i < LEVEL_POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, LEVEL_POLL_MS));
    if (gen !== generation) return;
    const res = await api.getFicha(videoId);
    if (gen !== generation || !res.ok) return;
    panel.setLevels(res.data.levels);
    if (res.data.levels.L2 !== 'pending' && res.data.levels.L4 !== 'pending') return;
  }
}

async function submitLabel(label: Label, reason: string): Promise<void> {
  const videoId = panel.currentVideo();
  if (!videoId) return;
  panel.setBusy(true);
  panel.setStatus(`etiquetando ${label}…`);
  let res = await api.postLabel(videoId, label, reason || undefined);
  if (!res.ok && res.status === 404 && lastFicha?.video_id === videoId) {
    // The ficha is missing (service DB reset?): re-send it and retry once.
    const saved = await api.postFicha(lastFicha);
    if (saved.ok) res = await api.postLabel(videoId, label, reason || undefined);
  }
  panel.setBusy(false);
  if (videoId !== panel.currentVideo()) return;
  if (!res.ok) {
    panel.setStatus(`no se pudo etiquetar: ${res.error}`, 'error');
    return;
  }
  panel.setLabel({ label: res.data.label, reason: res.data.reason, labeled_at: res.data.labeled_at, split: res.data.split });
  panel.setStatus(`etiquetado ${res.data.label} (${res.data.split})`, 'ok');
}

function checkLocation(): void {
  const ref = parseVideoUrl(location.href);
  if (!ref) {
    if (currentVideoId) {
      currentVideoId = null;
      generation++;
      panel.hide();
    }
    return;
  }
  if (ref.videoId !== currentVideoId) {
    debugLog('video detected', ref);
    void processVideo(ref);
  }
}

async function main(): Promise<void> {
  await initDebug();
  // Three navigation signals; checkLocation() is idempotent per videoId.
  onBridgeNavigation(() => checkLocation());
  document.addEventListener('yt-navigate-finish', () => checkLocation());
  window.setInterval(checkLocation, URL_POLL_MS); // Shorts swipes may only change the URL
  checkLocation();
}

void main();

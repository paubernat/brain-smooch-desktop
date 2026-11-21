// Content script (isolated world): detects the current video, asks the page
// bridge for its data, builds the ficha, POSTs it to the service (via the
// background script) and drives the label panel.
//
// Labels always go to the video in the address bar (on Shorts, the one on
// screen): a label for a video that is no longer current is refused, and a
// label given before the ficha is saved is queued and sent right after.
//
// Once the ficha is saved the live verdict is requested in the background; it
// is shown only while its video is still the current one. With reveal
// "after_label" the service hides it until the video is labelled, so the panel
// asks for it again after each label.
import { api } from './api';
import { onBridgeNavigation, requestSnapshot } from './bridge-client';
import { debugLog, dumpSpike, initDebug } from './debug';
import { buildFicha } from './extract/ficha';
import type { FichaPayload, FichaResponse, Label } from './types';
import { LabelPanel, signalBadges } from './ui/label-panel';
import { needsReveal, verdictErrorMessage } from './ui/verdict-view';
import { parseVideoUrl, type VideoRef } from './url';

const URL_POLL_MS = 500; // Shorts swipes may only change the URL
const LEVEL_POLL_MS = 3000;
const LEVEL_POLL_MAX = 10;

interface QueuedLabel {
  videoId: string;
  label: Label;
  reason: string;
}

let currentVideoId: string | null = null;
let generation = 0;
let lastFicha: FichaPayload | null = null;
/** Video whose ficha is saved in the service (labels can be sent right away). */
let readyVideoId: string | null = null;
let queued: QueuedLabel | null = null;

const panel = new LabelPanel({
  onLabel: (label, reason) => void requestLabel(label, reason),
  onRetry: () => {
    const ref = parseVideoUrl(location.href);
    if (ref) void processVideo(ref);
  },
  onOpenSettings: () => void api.openOptions(),
  onOpenCalibration: () => void api.openOptions('calibracion'),
});

function applyFicha(ficha: FichaResponse): void {
  panel.setLevels(ficha.levels);
  panel.setLabel(ficha.label);
}

async function processVideo(ref: VideoRef): Promise<void> {
  const gen = ++generation;
  const stale = () => gen !== generation;
  currentVideoId = ref.videoId;
  readyVideoId = null;
  if (queued?.videoId !== ref.videoId) queued = null;
  lastFicha = null;
  panel.mount();
  panel.setVideo(ref.videoId, '');
  panel.setReady(false);
  panel.setLevels({});
  panel.setBusy(true);
  panel.setStatus('leyendo vídeo…');
  void refreshPending();

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
    panel.setSignals(signalBadges(ficha.metadata));
    panel.setLevels({ L1: 'ok', L3: ficha.transcript.status, L4: ficha.storyboard ? 'pending' : 'none' });

    panel.setStatus('guardando ficha…');
    const res = await api.postFicha(ficha);
    if (stale()) return;
    if (!res.ok) {
      panel.setStatus(`servicio: ${res.error}`, 'error', true);
      return;
    }
    applyFicha(res.data);
    readyVideoId = ref.videoId;
    panel.setReady(true);
    panel.setStatus('ficha guardada', 'ok');
    void pollLevels(ref.videoId, gen);
    void loadVerdict(ref.videoId, gen);
    if (queued?.videoId === ref.videoId) {
      const { label, reason } = queued;
      queued = null;
      void sendLabel(ref.videoId, label, reason);
    }
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

/** Live verdict (rule, cache or judge call) for the video of generation `gen`. */
async function loadVerdict(videoId: string, gen: number): Promise<void> {
  const current = () => gen === generation && panel.currentVideo() === videoId;
  panel.setVerdict({ kind: 'loading' });
  const res = await api.requestVerdict(videoId);
  if (!current()) return;
  if (!res.ok) {
    panel.setVerdict({ kind: 'error', message: verdictErrorMessage(res.status, res.error) });
    return;
  }
  panel.setVerdict({ kind: 'ready', verdict: res.data });
}

/** After a label, a hidden verdict can be shown (the service decides). */
async function revealVerdict(videoId: string): Promise<void> {
  if (!needsReveal(panel.verdictState())) return;
  const gen = generation;
  const res = await api.getVerdict(videoId);
  if (gen !== generation || panel.currentVideo() !== videoId || !res.ok) return;
  panel.setVerdict({ kind: 'ready', verdict: res.data });
}

/** A click or shortcut on the panel: send now, queue, or refuse if the video changed. */
async function requestLabel(label: Label, reason: string): Promise<void> {
  const videoId = panel.currentVideo();
  if (!videoId) return;
  const onScreen = parseVideoUrl(location.href)?.videoId ?? null;
  if (onScreen !== videoId) {
    // The URL moved on (Shorts swipe) before the panel caught up: never label the old one.
    checkLocation();
    panel.setStatus('el vídeo ha cambiado: vuelve a etiquetar', 'error');
    return;
  }
  if (readyVideoId !== videoId) {
    queued = { videoId, label, reason };
    panel.setStatus(`${label}: se enviará en cuanto se guarde la ficha…`);
    return;
  }
  await sendLabel(videoId, label, reason);
}

async function sendLabel(videoId: string, label: Label, reason: string): Promise<void> {
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
  void refreshPending();
  void revealVerdict(videoId);
}

async function refreshPending(): Promise<void> {
  const res = await api.feedbackSummary();
  panel.setPending(res.ok ? { pending: res.data.pending, threshold: res.data.hint_threshold } : null);
}

function checkLocation(): void {
  const ref = parseVideoUrl(location.href);
  if (!ref) {
    if (currentVideoId) {
      currentVideoId = null;
      readyVideoId = null;
      queued = null;
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
  // Navigation signals; checkLocation() is idempotent per videoId.
  onBridgeNavigation(() => checkLocation());
  document.addEventListener('yt-navigate-finish', () => checkLocation());
  window.addEventListener('popstate', () => checkLocation());
  window.setInterval(checkLocation, URL_POLL_MS);
  checkLocation();
}

void main();

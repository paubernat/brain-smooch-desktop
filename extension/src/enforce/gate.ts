// Gate controller (content script): drives the state machine (gate-state.ts)
// with the service answers and renders it — pause the player, show the
// overlay, count LIMITADO time against the daily quota.
//
// Fail-closed: when enforcing, a service that does not answer within
// `service_timeout_s` (or a decision that takes longer than
// `decision_timeout_s`) blocks the video with a message and a retry button.
// Whether we are enforcing comes from the service, with the copy kept by the
// background (settings-sync.ts) as the fallback when it is down.
import { api } from '../api';
import type { ApiResult } from '../api-messages';
import { storageGet } from '../platform/storage';
import type { Label, LiveVerdict, QuotaToday } from '../types';
import { parseVideoUrl, type VideoRef } from '../url';
import { GateOverlay } from './gate-overlay';
import { countsQuota, gateReducer, gateVideoId, INITIAL_GATE, type FailureReason, type GateEvent, type GateState } from './gate-state';
import { overlayModel } from './overlay-model';
import { PlayerHold, progress, seekTo } from './player';
import { QuotaClock, quotaView, TICK_MS, type QuotaView } from './quota-clock';
import { QuotaPill } from './quota-pill';
import { ENFORCEMENT_KEY, parseEnforcement } from './settings';

export interface GateHooks {
  /** Run the whole video pipeline again (retry button). */
  onRetry: () => void;
  /** Quota of the current LIMITADO video, from the same clock as the pill (null: not counted). */
  onQuota: (view: QuotaView | null) => void;
  /** A "mark as error" label was stored (the panel shows it). */
  onLabelled: (videoId: string, label: Label) => void;
}

/** Text of a failed service call, for the error screen. */
function failureOf(res: { status: number | null; error: string }): { reason: FailureReason; detail: string } {
  return res.status === null ? { reason: 'unreachable', detail: res.error } : { reason: 'error', detail: `${res.error} (HTTP ${res.status})` };
}

const TAB_KEY = 'bsd-quota-tab';
const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Id of this tab for the service's heartbeat dedupe; kept in sessionStorage so a second copy
 * of the content script in the same tab (re-injection) shares it and cannot count twice. */
function quotaTabId(): string {
  try {
    const saved = sessionStorage.getItem(TAB_KEY);
    if (saved && TAB_ID.test(saved)) return saved;
  } catch {
    // storage blocked: a per-page id still works
  }
  const id = crypto.randomUUID();
  try {
    sessionStorage.setItem(TAB_KEY, id);
  } catch {
    // ignore
  }
  return id;
}

export class Gate {
  private state: GateState = INITIAL_GATE;
  private settings = parseEnforcement(undefined);
  private generation = 0;
  private decisionTimer: number | undefined;
  /** The tab's only quota clock: the pill and the panel both render its view. Heartbeat
   * numbers follow wall time, so a re-injected copy in the same tab always sends newer ones. */
  private readonly clock = new QuotaClock((prev) => Math.max(prev + 1, Date.now()));
  private readonly pill = new QuotaPill();
  private readonly tabId = quotaTabId();
  private resumedVideo: string | null = null;
  /** Last verdict answer, re-applied if the gate restarts for the same video. */
  private lastVerdict: { videoId: string; res: ApiResult<LiveVerdict> } | null = null;
  private readonly overlay: GateOverlay;
  private readonly hold: PlayerHold;

  constructor(private readonly hooks: GateHooks) {
    this.overlay = new GateOverlay({
      onRetry: () => hooks.onRetry(),
      onDashboard: () => void api.openOptions(),
      onDispute: (label, reason) => this.dispute(label, reason),
    });
    this.hold = new PlayerHold(() => this.mustHold());
    this.clock.subscribe(() => this.renderQuota());
    // ONE heartbeat loop for the life of the page (SPA navigations never add another).
    window.setInterval(() => this.tick(), TICK_MS);
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => {
      const videoId = gateVideoId(this.state);
      if (countsQuota(this.state) && videoId) void this.flush(videoId);
    });
    // The content script took over from early-hold.ts.
    document.dispatchEvent(new CustomEvent('bsd-gate-ready'));
  }

  /** Pause anything on a video page that the gate has not let through (also covers the
   * moment between an SPA navigation and `begin`). */
  private mustHold(): boolean {
    if (this.settings.mode !== 'soft') return false;
    const ref = parseVideoUrl(location.href);
    if (!ref) return false;
    return !(this.state.kind === 'playing' && this.state.videoId === ref.videoId);
  }

  /** A new video is on screen. */
  async begin(ref: VideoRef, shortsScroll: boolean): Promise<void> {
    const gen = ++this.generation;
    const videoId = ref.videoId;
    if (this.lastVerdict?.videoId !== videoId) this.lastVerdict = null;
    this.settings = parseEnforcement(await storageGet(ENFORCEMENT_KEY));
    if (gen !== this.generation) return;
    const start = () =>
      this.dispatch({ type: 'video', videoId, enforcing: this.settings.mode === 'soft', shortsScroll, blockShortsFeed: this.settings.block_shorts_feed });
    start();
    const fresh = await api.enforcement(this.settings.service_timeout_s * 1000);
    if (gen !== this.generation) return;
    if (fresh.ok) {
      const before = this.settings;
      this.settings = parseEnforcement(fresh.data);
      if (before.mode !== this.settings.mode || before.block_shorts_feed !== this.settings.block_shorts_feed) {
        start();
        if (this.lastVerdict?.videoId === videoId) void this.verdict(videoId, this.lastVerdict.res);
      }
    } else if (this.settings.mode === 'soft') {
      this.dispatch({ type: 'failure', videoId, ...failureOf(fresh) });
    }
    if (this.state.kind === 'deciding') {
      this.decisionTimer = window.setTimeout(() => {
        if (gen === this.generation) this.dispatch({ type: 'failure', videoId, reason: 'timeout' });
      }, this.settings.decision_timeout_s * 1000);
    }
  }

  /** The page is no longer a video page. */
  leave(): void {
    this.generation++;
    this.dispatch({ type: 'leave' });
  }

  /** Answer of POST /verdicts for `videoId`. */
  async verdict(videoId: string, res: ApiResult<LiveVerdict>): Promise<void> {
    this.lastVerdict = { videoId, res };
    if (!res.ok) return this.fail(videoId, failureOf(res).reason, failureOf(res).detail);
    const gate = res.data.gate;
    if (!gate) return this.fail(videoId, 'error', 'no gate decision in the verdict');
    this.dispatch({ type: 'verdict', videoId, gate, detail: null });
    if (this.state.kind === 'checking_quota' && this.state.videoId === videoId) await this.checkQuota(videoId);
  }

  /** Scrolled Shorts are blocked whatever the verdict: no need to pay for one. */
  skipsVerdict(videoId: string): boolean {
    return this.state.kind === 'blocked' && this.state.videoId === videoId && this.state.reason === 'shorts_feed';
  }

  /** Extraction or ficha upload failed: nothing to judge with. */
  fail(videoId: string, reason: FailureReason, detail: string | null = null): void {
    this.dispatch({ type: 'failure', videoId, reason, detail });
  }

  private async checkQuota(videoId: string): Promise<void> {
    const p = progress();
    const res = await api.quotaToday(videoId, p.duration, p.position, this.settings.service_timeout_s * 1000);
    if (!res.ok) return this.fail(videoId, failureOf(res).reason, failureOf(res).detail);
    if (!countsQuota(this.state)) this.clock.sync(res.data); // the snapshot the countdown starts from
    this.dispatch({ type: 'quota', videoId, quota: res.data });
  }

  private dispatch(event: GateEvent): void {
    const before = this.state;
    this.state = gateReducer(this.state, event);
    if (this.state.kind !== 'deciding') window.clearTimeout(this.decisionTimer);
    this.render(before);
  }

  private render(before: GateState): void {
    const state = this.state;
    const model = overlayModel(state);
    const key = state.kind === 'blocked' ? `${state.videoId}:${state.reason}` : `${gateVideoId(state)}:${state.kind}`;
    this.overlay.render(model, key);
    this.hold.apply();
    if (countsQuota(state)) {
      if (state.kind === 'playing') this.maybeResume(state.videoId, state.quota);
    } else if (countsQuota(before)) {
      // Final partial heartbeat of the video that stopped counting, then a clean clock.
      void this.flush(gateVideoId(before));
      this.clock.reset();
    }
    this.renderQuota();
  }

  /** Pill and panel render the same view of the same clock. While blocked, the panel
   * shows the service's last answer (the pill is hidden). */
  private renderQuota(): void {
    const state = this.state;
    const live = countsQuota(state) ? this.clock.view() : null;
    this.pill.render(live);
    this.hooks.onQuota(live ?? (state.kind === 'blocked' && state.quota ? quotaView(state.quota) : null));
  }

  /** Long video cut on a previous day: jump to where it stopped (once). */
  private maybeResume(videoId: string, quota: QuotaToday | null): void {
    const at = quota?.video?.resume_at_s;
    if (!at || this.resumedVideo === videoId) return;
    this.resumedVideo = videoId;
    seekTo(at);
  }

  /** Counts only while the video really plays (no pause, buffering or ad) in the visible tab. */
  private tick(): void {
    const state = this.state;
    if (!countsQuota(state) || state.kind !== 'playing') return;
    const counting = progress().playing && document.visibilityState === 'visible';
    if (this.clock.tick(Date.now(), counting)) void this.flush(state.videoId);
  }

  /** Hidden: send what was watched now. Visible again: resync (another tab may have spent quota). */
  private onVisibility(): void {
    this.tick();
    const state = this.state;
    if (document.visibilityState !== 'visible' || !countsQuota(state) || state.kind !== 'playing') return;
    const videoId = state.videoId;
    const p = progress();
    void api.quotaToday(videoId, p.duration, p.position, this.settings.service_timeout_s * 1000).then((res) => {
      if (!res.ok || gateVideoId(this.state) !== videoId || !countsQuota(this.state)) return;
      this.clock.sync(res.data);
      this.dispatch({ type: 'quota', videoId, quota: res.data });
    });
  }

  /** Sends the watched seconds; the answer re-syncs the clock and may block the video. */
  private async flush(videoId: string | null): Promise<void> {
    const beat = this.clock.take();
    if (!videoId || !beat) return;
    const p = progress();
    const body = { video_id: videoId, seconds: beat.seconds, duration_s: p.duration, position_s: p.position, tab_id: this.tabId, seq: beat.seq };
    const res = await api.quotaHeartbeat(body, this.settings.service_timeout_s * 1000);
    if (!res.ok) this.clock.failed(beat.seq);
    if (gateVideoId(this.state) !== videoId) return;
    if (!res.ok) return this.fail(videoId, failureOf(res).reason, failureOf(res).detail);
    this.clock.sync(res.data, beat.seq);
    this.dispatch({ type: 'quota', videoId, quota: res.data });
  }

  private async dispute(label: Exclude<Label, 'NO'>, reason: string): Promise<boolean> {
    const videoId = gateVideoId(this.state);
    if (!videoId) return false;
    const res = await api.postLabel(videoId, label, reason || undefined);
    if (res.ok) this.hooks.onLabelled(videoId, label);
    return res.ok;
  }
}

// The ONE quota clock of a tab (pure, unit-tested): it owns the service's
// snapshot (remaining seconds, exhausted, grace) and the watched time the
// service has not counted yet, both unsent and in flight. Every display (the
// pill above the video and the label panel) subscribes to it, so they always
// show the same mm:ss; the heartbeat loop takes its seconds from it.
//
// Only time while the video really plays in a visible tab counts; gaps longer
// than a tick (throttled tab, sleep) count as one tick at most.
import type { QuotaToday } from '../types';
import { remainingFor } from './quota-countdown';

export const TICK_MS = 1000;
export const HEARTBEAT_MS = 15_000;
const MAX_GAP_MS = 2 * TICK_MS;

/** What the displays show. */
export interface QuotaView {
  /** Seconds the current video may still play (grace time while in grace). */
  seconds: number;
  grace: boolean;
  exhausted: boolean;
  daily_s: number;
  /** Used fraction of the daily quota, extrapolated (0..1). */
  fraction: number;
}

/** A heartbeat to send: `seq` is unique per tab and increasing. */
export interface Beat {
  seq: number;
  seconds: number;
}

/** Static view of a service answer (no local time on top). */
export function quotaView(quota: QuotaToday, localS = 0): QuotaView {
  const { seconds, grace } = remainingFor(quota);
  const used = quota.used_s + (grace ? 0 : localS);
  return {
    seconds: Math.max(0, seconds - localS),
    grace,
    exhausted: quota.exhausted && !grace,
    daily_s: quota.daily_s,
    fraction: quota.daily_s <= 0 ? 1 : Math.min(1, Math.max(0, used / quota.daily_s)),
  };
}

type Listener = (view: QuotaView | null) => void;

export class QuotaClock {
  private snapshot: QuotaToday | null = null;
  private appliedSeq = 0;
  private seq = 0;
  private last: number | null = null;
  private wasCounting = false;
  private pendingMs = 0;
  private sinceBeatMs = 0;
  private readonly inFlight = new Map<number, number>();
  private readonly listeners = new Set<Listener>();

  /** `nextSeq` numbers the heartbeats (strictly increasing). */
  constructor(private readonly nextSeq: (prev: number) => number = (prev) => prev + 1) {}

  /** Called on every change of the view (not immediately). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Answer of the service. With `seq` it acknowledges that heartbeat (its seconds are
   * now in the snapshot); an older answer arriving late never overrides a newer one. A
   * plain GET (no `seq`) is ignored while a heartbeat is in flight (it may predate it). */
  sync(quota: QuotaToday, seq?: number): void {
    if (seq === undefined) {
      if (this.inFlight.size) return;
    } else {
      if (!this.inFlight.delete(seq)) return; // unknown or from before reset()
      if (seq < this.appliedSeq) return this.notify();
      this.appliedSeq = seq;
    }
    this.snapshot = quota;
    this.notify();
  }

  /** The heartbeat `seq` failed: its seconds go back to the unsent ones. */
  failed(seq: number): void {
    const ms = this.inFlight.get(seq);
    if (ms === undefined) return;
    this.inFlight.delete(seq);
    this.pendingMs += ms;
  }

  /** Call every tick (and on pause/visibility changes); returns true when a heartbeat is due:
   * every 15 s of counting, when counting stops (pause, hidden, ad) or when the time runs out. */
  tick(nowMs: number, counting: boolean): boolean {
    const gap = this.last === null ? 0 : Math.min(Math.max(0, nowMs - this.last), MAX_GAP_MS);
    this.last = nowMs;
    if (counting) this.pendingMs += gap;
    this.sinceBeatMs += gap;
    const stopped = this.wasCounting && !counting;
    this.wasCounting = counting;
    if (counting && gap > 0) this.notify();
    if (this.pendingMs <= 0) return false;
    const runOut = this.snapshot !== null && this.inFlight.size === 0 && (this.view()?.seconds ?? 1) <= 0;
    return this.sinceBeatMs >= HEARTBEAT_MS || stopped || runOut;
  }

  /** Seconds to report now (null: nothing to report). They stay counted locally until acknowledged. */
  take(): Beat | null {
    const ms = Math.floor(this.pendingMs / 100) * 100; // 0.1 s steps; the remainder waits
    this.sinceBeatMs = 0;
    if (ms <= 0) return null;
    this.pendingMs -= ms;
    const seq = (this.seq = this.nextSeq(this.seq));
    this.inFlight.set(seq, ms);
    return { seq, seconds: ms / 1000 };
  }

  /** Watched seconds the snapshot does not include yet. */
  get localSeconds(): number {
    let ms = this.pendingMs;
    for (const v of this.inFlight.values()) ms += v;
    return ms / 1000;
  }

  view(): QuotaView | null {
    return this.snapshot ? quotaView(this.snapshot, this.localSeconds) : null;
  }

  /** A new video (or none): forget the snapshot and the uncounted time (take() it first). */
  reset(): void {
    this.snapshot = null;
    this.last = null;
    this.wasCounting = false;
    this.pendingMs = 0;
    this.sinceBeatMs = 0;
    this.inFlight.clear();
    this.notify();
  }

  private notify(): void {
    const view = this.view();
    for (const listener of this.listeners) listener(view);
  }
}

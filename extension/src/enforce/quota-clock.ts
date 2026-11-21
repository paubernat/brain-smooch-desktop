// Watched-time accumulator for the quota heartbeat (pure, unit-tested).
// Only time while the video plays in a visible tab counts; gaps longer than a
// tick (the tab was throttled or the machine slept) count as one tick at most.

export const TICK_MS = 1000;
export const HEARTBEAT_MS = 15_000;
const MAX_GAP_MS = 2 * TICK_MS;

export class QuotaClock {
  private last: number | null = null;
  private pendingMs = 0;
  private sinceBeatMs = 0;

  /** Call every tick; returns true when a heartbeat is due. */
  tick(nowMs: number, playing: boolean, visible: boolean): boolean {
    const gap = this.last === null ? 0 : Math.min(Math.max(0, nowMs - this.last), MAX_GAP_MS);
    this.last = nowMs;
    if (playing && visible) this.pendingMs += gap;
    this.sinceBeatMs += gap;
    return this.sinceBeatMs >= HEARTBEAT_MS && this.pendingMs > 0;
  }

  /** Seconds to report (and resets the counters). */
  take(): number {
    const seconds = Math.round(this.pendingMs / 100) / 10;
    this.pendingMs = 0;
    this.sinceBeatMs = 0;
    return seconds;
  }

  reset(): void {
    this.last = null;
    this.pendingMs = 0;
    this.sinceBeatMs = 0;
  }
}

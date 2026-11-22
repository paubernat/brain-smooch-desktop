// Visible countdown of the LIMITADO quota (pure, unit-tested). The service is
// the source of truth: every heartbeat answer re-syncs the remaining seconds;
// in between, the pill counts down locally once per second, but only while
// the video plays in the visible tab (the same time the heartbeat reports).
import type { QuotaToday } from '../types';

const MAX_GAP_MS = 2000; // a throttled tab or a sleep counts as one tick at most

/** 754 -> "12:34", 5 -> "0:05", 3725 -> "1:02:05". Rounds up: "0:00" only when nothing is left. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds - 1e-9));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Seconds the current video may still play: its grace time, or the day's quota left. */
export function remainingFor(quota: QuotaToday): { seconds: number; grace: boolean } {
  if (quota.video?.state === 'grace') return { seconds: quota.video.grace_remaining_s, grace: true };
  return { seconds: quota.remaining_s, grace: false };
}

export class QuotaCountdown {
  private synced = 0;
  private playedMs = 0;
  private last: number | null = null;
  grace = false;

  /** New answer from the service (GET /quota/today or a heartbeat). */
  sync(quota: QuotaToday): void {
    const { seconds, grace } = remainingFor(quota);
    this.synced = seconds;
    this.grace = grace;
    this.playedMs = 0;
  }

  /** Call every second; counts only while playing in a visible tab. */
  tick(nowMs: number, counting: boolean): void {
    const gap = this.last === null ? 0 : Math.min(Math.max(0, nowMs - this.last), MAX_GAP_MS);
    this.last = nowMs;
    if (counting) this.playedMs += gap;
  }

  reset(): void {
    this.synced = 0;
    this.playedMs = 0;
    this.last = null;
    this.grace = false;
  }

  /** Local estimate of the seconds left. */
  get remaining(): number {
    return Math.max(0, this.synced - this.playedMs / 1000);
  }
}

// Countdown formatting shared by the pill and the label panel (pure, unit-tested).
// The live value comes from the tab's single QuotaClock (quota-clock.ts).
import type { QuotaToday } from '../types';

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

// Quota meter texts (label panel, block overlay, dashboard). Pure, unit-tested.
import { t } from '../options/i18n';
import type { QuotaToday } from '../types';

/** 75 -> "1 min", 3600 -> "60 min", 5400 -> "1 h 30 min". Rounds up: never shows 0 with time left. */
export function formatMinutes(seconds: number): string {
  const minutes = Math.max(0, Math.ceil(seconds / 60 - 1e-9));
  if (minutes < 90) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** 1500 -> "25:00", 3725 -> "1:02:05". */
export function formatPosition(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** Fraction of the daily quota already used (0..1). */
export function usedFraction(quota: Pick<QuotaToday, 'used_s' | 'daily_s'>): number {
  if (quota.daily_s <= 0) return 1;
  return Math.min(1, Math.max(0, quota.used_s / quota.daily_s));
}

/** One line for the label panel: "LIMITADO · 12 min left of 30 min" / grace / exhausted. */
export function quotaLine(quota: QuotaToday): string {
  const video = quota.video;
  if (video?.state === 'grace') return t('quota.grace', { left: formatMinutes(video.grace_remaining_s) });
  if (quota.exhausted) return t('quota.exhausted', { daily: formatMinutes(quota.daily_s) });
  return t('quota.left', { left: formatMinutes(quota.remaining_s), daily: formatMinutes(quota.daily_s) });
}

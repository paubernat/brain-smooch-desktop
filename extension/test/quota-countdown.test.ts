// Visible LIMITADO countdown (pill on YouTube) and the layers panel query.
import { describe, expect, it } from 'vitest';
import { formatCountdown, QuotaCountdown, remainingFor } from '../src/enforce/quota-countdown';
import { systemEventsQuery } from '../src/options/api';
import type { QuotaToday } from '../src/types';

function quota(extra: Partial<QuotaToday> = {}): QuotaToday {
  return {
    day: '2026-11-22',
    daily_s: 1800,
    used_s: 600,
    remaining_s: 1200,
    exhausted: false,
    grace_video: null,
    video: { allowed: true, state: 'ok', grace_remaining_s: 0, resume_at_s: null },
    ...extra,
  };
}

describe('formatCountdown', () => {
  it('formats minutes and seconds', () => {
    expect(formatCountdown(754)).toBe('12:34');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(1800)).toBe('30:00');
  });

  it('adds hours past 60 minutes', () => {
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(3725)).toBe('1:02:05');
  });

  it('rounds up and never goes negative', () => {
    expect(formatCountdown(0.2)).toBe('0:01');
    expect(formatCountdown(59.5)).toBe('1:00');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('QuotaCountdown', () => {
  it('counts down only while playing in a visible tab', () => {
    const c = new QuotaCountdown();
    c.sync(quota({ remaining_s: 100 }));
    c.tick(0, true);
    c.tick(1000, true);
    c.tick(2000, true);
    expect(c.remaining).toBe(98);
    c.tick(3000, false); // paused or hidden
    c.tick(4000, false);
    expect(c.remaining).toBe(98);
    c.tick(5000, true);
    expect(c.remaining).toBe(97);
  });

  it('counts a long gap (sleep, throttled tab) as one tick at most', () => {
    const c = new QuotaCountdown();
    c.sync(quota({ remaining_s: 100 }));
    c.tick(0, true);
    c.tick(60_000, true);
    expect(c.remaining).toBe(98);
  });

  it('resyncs with each heartbeat answer', () => {
    const c = new QuotaCountdown();
    c.sync(quota({ remaining_s: 100 }));
    c.tick(0, true);
    c.tick(1000, true);
    c.sync(quota({ remaining_s: 80 }));
    expect(c.remaining).toBe(80);
    c.tick(2000, true);
    expect(c.remaining).toBe(79);
  });

  it('shows the grace time of the video when in grace', () => {
    const q = quota({ remaining_s: 0, exhausted: true, video: { allowed: true, state: 'grace', grace_remaining_s: 420, resume_at_s: null } });
    expect(remainingFor(q)).toEqual({ seconds: 420, grace: true });
    const c = new QuotaCountdown();
    c.sync(q);
    expect(c.grace).toBe(true);
    expect(c.remaining).toBe(420);
  });

  it('stops at zero', () => {
    const c = new QuotaCountdown();
    c.sync(quota({ remaining_s: 1 }));
    c.tick(0, true);
    c.tick(2000, true);
    c.tick(4000, true);
    expect(c.remaining).toBe(0);
  });
});

describe('systemEventsQuery', () => {
  it('repeats kind for the FastAPI list parameter', () => {
    expect(systemEventsQuery(['tamper', 'error'], 10)).toBe('kind=tamper&kind=error&limit=10');
  });
});

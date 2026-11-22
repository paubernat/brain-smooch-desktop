// Visible LIMITADO countdown (pill on YouTube) and the layers panel query.
import { describe, expect, it } from 'vitest';
import { isPlaying } from '../src/enforce/player';
import { QuotaClock } from '../src/enforce/quota-clock';
import { formatCountdown, remainingFor } from '../src/enforce/quota-countdown';
import { quotaLine } from '../src/enforce/quota-view';
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

/** Drives the clock: `seconds` ticks of 1 s with `counting`. */
function play(c: QuotaClock, from: number, seconds: number, counting = true): { now: number; due: boolean } {
  let now = from;
  let due = false;
  for (let i = 0; i < seconds; i++) due = c.tick((now += 1000), counting) || due;
  return { now, due };
}

function started(remaining: number): { c: QuotaClock; now: number } {
  const c = new QuotaClock();
  c.sync(quota({ remaining_s: remaining, used_s: 1800 - remaining }));
  c.tick(0, true);
  return { c, now: 0 };
}

describe('QuotaClock (single source for the pill and the panel)', () => {
  it('pill and panel show the same mm:ss (the panel used to round to minutes and lag a heartbeat)', () => {
    const { c, now } = started(489.2);
    play(c, now, 7);
    const view = c.view()!;
    const pillTime = formatCountdown(view.seconds);
    expect(pillTime).toBe('8:03');
    expect(quotaLine(view)).toBe(`Cupo: quedan ${pillTime} de 30 min`);
  });

  it('notifies subscribers each counted second', () => {
    const { c, now } = started(100);
    const seen: string[] = [];
    c.subscribe((v) => seen.push(formatCountdown(v!.seconds)));
    play(c, now, 3);
    play(c, now + 3000, 2, false); // paused: nothing moves
    expect(seen).toEqual(['1:39', '1:38', '1:37']);
  });

  it('counts down only while playing in a visible tab', () => {
    const { c, now } = started(100);
    let t = play(c, now, 2).now;
    t = play(c, t, 2, false).now;
    play(c, t, 1);
    expect(c.view()!.seconds).toBe(97);
  });

  it('counts a long gap (sleep, throttled tab) as one tick at most', () => {
    const { c } = started(100);
    c.tick(60_000, true);
    expect(c.view()!.seconds).toBe(98);
  });

  it('keeps the time played while a heartbeat is in flight (no jump back up on the answer)', () => {
    const { c, now } = started(100);
    const t = play(c, now, 15).now;
    const beat = c.take()!;
    expect(beat.seconds).toBe(15);
    expect(c.view()!.seconds).toBe(85); // still counted locally while in flight
    play(c, t, 2); // round trip: 2 s more played
    c.sync(quota({ remaining_s: 85, used_s: 1715 }), beat.seq);
    expect(c.view()!.seconds).toBe(83); // the old countdown showed 85 here
  });

  it('ignores a late answer older than one already applied', () => {
    const { c, now } = started(100);
    let t = play(c, now, 15).now;
    const first = c.take()!;
    t = play(c, t, 15).now;
    const second = c.take()!;
    c.sync(quota({ remaining_s: 70 }), second.seq);
    c.sync(quota({ remaining_s: 85 }), first.seq);
    expect(c.view()!.seconds).toBe(70);
    c.sync(quota({ remaining_s: 10 }), 999); // unknown heartbeat: ignored
    expect(c.view()!.seconds).toBe(70);
    play(c, t, 1);
    c.sync(quota({ remaining_s: 50 })); // plain GET with nothing in flight: applied
    expect(c.view()!.seconds).toBe(49);
  });

  it('sends a final partial heartbeat as soon as playback stops', () => {
    const { c, now } = started(100);
    const t = play(c, now, 4).now;
    expect(c.tick(t + 1000, false)).toBe(true); // pause / hidden / ad
    expect(c.take()!.seconds).toBe(4);
    expect(c.tick(t + 2000, false)).toBe(false);
    expect(c.take()).toBeNull();
  });

  it('beats right away when the local countdown runs out', () => {
    const { c, now } = started(3);
    expect(play(c, now, 3).due).toBe(true);
    expect(c.view()!.seconds).toBe(0);
  });

  it('gives a failed heartbeat back to the unsent seconds', () => {
    const { c, now } = started(100);
    play(c, now, 15);
    const beat = c.take()!;
    c.failed(beat.seq);
    expect(c.take()!.seconds).toBe(15);
  });

  it('numbers heartbeats with the given sequence (wall-time based in the gate)', () => {
    const c = new QuotaClock((prev) => Math.max(prev + 1, 1_000));
    c.tick(0, true);
    c.tick(1000, true);
    expect(c.take()!.seq).toBe(1_000);
    c.tick(2000, true);
    expect(c.take()!.seq).toBe(1_001);
  });

  it('counts the grace time of the video when in grace', () => {
    const q = quota({ remaining_s: 0, used_s: 1800, exhausted: true, video: { allowed: true, state: 'grace', grace_remaining_s: 420, resume_at_s: null } });
    expect(remainingFor(q)).toEqual({ seconds: 420, grace: true });
    const c = new QuotaClock();
    c.sync(q);
    c.tick(0, true);
    c.tick(1000, true);
    const view = c.view()!;
    expect(view).toMatchObject({ grace: true, exhausted: false, seconds: 419, fraction: 1 });
    expect(quotaLine(view)).toBe('Gracia para terminar: 6:59');
  });

  it('stops at zero and resets to nothing', () => {
    const { c, now } = started(1);
    play(c, now, 3);
    expect(c.view()!.seconds).toBe(0);
    c.reset();
    expect(c.view()).toBeNull();
  });
});

describe('isPlaying', () => {
  const video = { paused: false, ended: false, seeking: false, readyState: 4 };
  it('does not count buffering, seeking, paused, ended or ads', () => {
    expect(isPlaying(video, false)).toBe(true);
    expect(isPlaying({ ...video, readyState: 2 }, false)).toBe(false);
    expect(isPlaying({ ...video, seeking: true }, false)).toBe(false);
    expect(isPlaying({ ...video, paused: true }, false)).toBe(false);
    expect(isPlaying({ ...video, ended: true }, false)).toBe(false);
    expect(isPlaying(video, true)).toBe(false);
  });
});

describe('systemEventsQuery', () => {
  it('repeats kind for the FastAPI list parameter', () => {
    expect(systemEventsQuery(['tamper', 'error'], 10)).toBe('kind=tamper&kind=error&limit=10');
  });
});

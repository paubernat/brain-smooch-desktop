// Gate (H1), quota (H2) and Shorts feed detection: pure parts.
import { describe, expect, it } from 'vitest';
import { ALLOWED_PATHS, isApiRequest, timeoutFor } from '../src/api-messages';
import { quotaTodayPath } from '../src/api';
import { allowsPlayback, countsQuota, gateReducer, INITIAL_GATE, type GateEvent, type GateState } from '../src/enforce/gate-state';
import { blockReason, overlayModel, START_COMMAND } from '../src/enforce/overlay-model';
import { HEARTBEAT_MS, QuotaClock } from '../src/enforce/quota-clock';
import { formatMinutes, formatPosition, quotaLine, usedFraction } from '../src/enforce/quota-view';
import { DEFAULT_ENFORCEMENT, parseEnforcement } from '../src/enforce/settings';
import { isShortsScroll, NavTracker, navStep } from '../src/enforce/shorts-scroll';
import { custodianFormError } from '../src/options/views/custodian';
import type { GateDecision, QuotaToday } from '../src/types';
import { parseVideoUrl } from '../src/url';

const step = (href: string) => navStep(parseVideoUrl(href));
const SHORT_A = 'https://www.youtube.com/shorts/AAAAAAAAAAA';
const SHORT_B = 'https://www.youtube.com/shorts/BBBBBBBBBBB';
const WATCH = 'https://www.youtube.com/watch?v=CCCCCCCCCCC';
const SEARCH = 'https://www.youtube.com/results?search_query=jazz';

function gate(action: GateDecision['action'], extra: Partial<GateDecision> = {}): GateDecision {
  const label = action === 'block' ? 'NO' : action === 'limit' ? 'LIMITADO' : 'LIBRE';
  return { action, label, low_confidence: false, source: 'model', rule: null, confidence: 0.9, ...extra };
}

function quota(extra: Partial<QuotaToday> = {}): QuotaToday {
  return {
    day: '2026-11-21',
    daily_s: 1800,
    used_s: 600,
    remaining_s: 1200,
    exhausted: false,
    grace_video: null,
    video: { allowed: true, state: 'ok', grace_remaining_s: 0, resume_at_s: null },
    ...extra,
  };
}

describe('Shorts feed detection', () => {
  it('a Short to another Short within the page is scrolling', () => {
    expect(isShortsScroll(step(SHORT_A), step(SHORT_B), true)).toBe(true);
  });

  it('a Short reached from elsewhere, or after a reload, is judged like any video', () => {
    expect(isShortsScroll(null, step(SHORT_A), false)).toBe(false);
    expect(isShortsScroll(step(SHORT_A), step(SHORT_B), false)).toBe(false); // full page load
    expect(isShortsScroll(step(SEARCH), step(SHORT_A), true)).toBe(false);
    expect(isShortsScroll(step(WATCH), step(SHORT_A), true)).toBe(false);
    expect(isShortsScroll(step(SHORT_A), step(SHORT_A), true)).toBe(false);
    expect(isShortsScroll(step(SHORT_A), step(WATCH), true)).toBe(false);
  });

  it('tracks the pages of the tab', () => {
    const nav = new NavTracker();
    expect(nav.visit(step(SHORT_A))).toBe(false); // opened directly
    expect(nav.visit(step(SHORT_B))).toBe(true); // swipe
    expect(nav.visit(step(SEARCH))).toBe(false);
    expect(nav.visit(step(SHORT_A))).toBe(false); // from the search results
    expect(nav.visit(step(`${SHORT_A}?feature=share`))).toBe(false); // same Short
    expect(nav.visit(step(SHORT_B))).toBe(true);
    expect(nav.visit(step(SHORT_A))).toBe(true); // back to the previous one: still the feed
  });
});

describe('gate state machine', () => {
  const run = (events: GateEvent[], from: GateState = INITIAL_GATE) => events.reduce(gateReducer, from);
  const open = (videoId = 'v1', extra: Partial<Extract<GateEvent, { type: 'video' }>> = {}): GateEvent => ({
    type: 'video',
    videoId,
    enforcing: true,
    shortsScroll: false,
    blockShortsFeed: true,
    ...extra,
  });

  it('does nothing when blocking is off (labelling only)', () => {
    const state = run([open('v1', { enforcing: false })]);
    expect(state).toEqual(INITIAL_GATE);
    expect(allowsPlayback(state)).toBe(true);
  });

  it('holds the video while deciding, then applies the verdict', () => {
    expect(run([open()])).toEqual({ kind: 'deciding', videoId: 'v1' });
    expect(allowsPlayback(run([open()]))).toBe(false);
    const free = run([open(), { type: 'verdict', videoId: 'v1', gate: gate('allow'), detail: null }]);
    expect(free.kind).toBe('playing');
    expect(allowsPlayback(free) && !countsQuota(free)).toBe(true);
    const no = run([open(), { type: 'verdict', videoId: 'v1', gate: gate('block'), detail: null }]);
    expect(no).toMatchObject({ kind: 'blocked', reason: 'verdict' });
  });

  it('LIMITADO checks the quota, counts time and blocks when it runs out', () => {
    const checking = run([open(), { type: 'verdict', videoId: 'v1', gate: gate('limit'), detail: null }]);
    expect(checking.kind).toBe('checking_quota');
    expect(allowsPlayback(checking)).toBe(false);
    const playing = gateReducer(checking, { type: 'quota', videoId: 'v1', quota: quota() });
    expect(playing).toMatchObject({ kind: 'playing', limited: true });
    expect(countsQuota(playing)).toBe(true);
    const exhausted = quota({ used_s: 1800, remaining_s: 0, exhausted: true, video: { allowed: false, state: 'exhausted', grace_remaining_s: 0, resume_at_s: null } });
    expect(gateReducer(playing, { type: 'quota', videoId: 'v1', quota: exhausted })).toMatchObject({ kind: 'blocked', reason: 'quota' });
    const long = quota({ exhausted: true, video: { allowed: false, state: 'resume_tomorrow', grace_remaining_s: 0, resume_at_s: 1500 } });
    expect(gateReducer(checking, { type: 'quota', videoId: 'v1', quota: long })).toMatchObject({ kind: 'blocked', reason: 'resume_tomorrow' });
  });

  it('blocks the Shorts feed without asking anyone', () => {
    expect(run([open('s2', { shortsScroll: true })])).toMatchObject({ kind: 'blocked', reason: 'shorts_feed' });
    expect(run([open('s2', { shortsScroll: true, blockShortsFeed: false })]).kind).toBe('deciding');
  });

  it('fails closed', () => {
    expect(run([open(), { type: 'failure', videoId: 'v1', reason: 'unreachable' }])).toMatchObject({ kind: 'blocked', reason: 'unreachable' });
    expect(run([open(), { type: 'failure', videoId: 'v1', reason: 'timeout' }])).toMatchObject({ kind: 'blocked', reason: 'timeout' });
    const limited = run([open(), { type: 'verdict', videoId: 'v1', gate: gate('limit'), detail: null }, { type: 'quota', videoId: 'v1', quota: quota() }]);
    expect(gateReducer(limited, { type: 'failure', videoId: 'v1', reason: 'unreachable' })).toMatchObject({ kind: 'blocked' });
    // A LIBRE video needs nothing more from the service.
    const free = run([open(), { type: 'verdict', videoId: 'v1', gate: gate('allow'), detail: null }]);
    expect(gateReducer(free, { type: 'failure', videoId: 'v1', reason: 'unreachable' })).toBe(free);
    // A late verdict never unblocks a timed-out video.
    const timedOut = run([open(), { type: 'failure', videoId: 'v1', reason: 'timeout' }]);
    expect(gateReducer(timedOut, { type: 'verdict', videoId: 'v1', gate: gate('allow'), detail: null })).toBe(timedOut);
  });

  it('only ever acts on the current video', () => {
    const deciding = run([open('v1'), open('v2')]);
    expect(deciding).toEqual({ kind: 'deciding', videoId: 'v2' });
    expect(gateReducer(deciding, { type: 'verdict', videoId: 'v1', gate: gate('allow'), detail: null })).toBe(deciding);
    expect(gateReducer(deciding, { type: 'failure', videoId: 'v1', reason: 'error' })).toBe(deciding);
    expect(gateReducer(deciding, { type: 'leave' })).toEqual(INITIAL_GATE);
  });
});

describe('overlay', () => {
  it('shows "deciding" and nothing while playing', () => {
    expect(overlayModel({ kind: 'deciding', videoId: 'v1' })).toMatchObject({ tone: 'deciding', title: 'Decidiendo…' });
    expect(overlayModel({ kind: 'playing', videoId: 'v1', limited: false, gate: gate('allow'), quota: null })).toBeNull();
    expect(overlayModel(INITIAL_GATE)).toBeNull();
  });

  it('explains a block and offers to mark it as a mistake', () => {
    const blocked: GateState = { kind: 'blocked', videoId: 'v1', reason: 'verdict', detail: null, gate: gate('block', { confidence: 0.87 }), quota: null };
    const model = overlayModel(blocked);
    expect(model?.lead).toContain('87 %');
    expect(model?.actions).toContain('dispute');
    expect(blockReason(gate('block', { source: 'rule', rule: 'channel_list', confidence: 1 }))).toContain('lista NO');
    expect(blockReason(gate('block', { source: 'rule', rule: 'block_live', confidence: 1 }))).toContain('directo');
  });

  it('shows how to start the service when it is down', () => {
    const down = overlayModel({ kind: 'blocked', videoId: 'v1', reason: 'unreachable', detail: null, gate: null, quota: null });
    expect(down?.command).toBe(START_COMMAND);
    expect(down?.actions).toContain('retry');
  });

  it('shows the quota and the resume position', () => {
    const q = quota({ used_s: 1800, remaining_s: 0, exhausted: true, video: { allowed: false, state: 'resume_tomorrow', grace_remaining_s: 0, resume_at_s: 1500 } });
    const model = overlayModel({ kind: 'blocked', videoId: 'v1', reason: 'resume_tomorrow', detail: null, gate: gate('limit'), quota: q });
    expect(model?.lead).toContain('25:00');
    expect(model?.meter).toBe(1);
  });
});

describe('quota display', () => {
  it('formats minutes and positions', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(61)).toBe('2 min');
    expect(formatMinutes(1800)).toBe('30 min');
    expect(formatMinutes(5400)).toBe('1 h 30 min');
    expect(formatMinutes(7200)).toBe('2 h');
    expect(formatPosition(1500)).toBe('25:00');
    expect(formatPosition(3725)).toBe('1:02:05');
  });

  it('computes the meter and the panel line', () => {
    expect(usedFraction({ used_s: 900, daily_s: 1800 })).toBe(0.5);
    expect(usedFraction({ used_s: 10, daily_s: 0 })).toBe(1);
    expect(quotaLine(quota())).toBe('Cupo: quedan 20 min de 30 min');
    expect(quotaLine(quota({ exhausted: true, remaining_s: 0 }))).toContain('agotado');
    expect(quotaLine(quota({ video: { allowed: true, state: 'grace', grace_remaining_s: 420, resume_at_s: null } }))).toBe('Gracia para terminar: 7 min');
  });

  it('counts only time played in a visible tab', () => {
    const clock = new QuotaClock();
    let now = 0;
    clock.tick(now, true, true);
    for (let i = 0; i < 5; i++) clock.tick((now += 1000), true, false); // hidden tab
    for (let i = 0; i < 5; i++) clock.tick((now += 1000), false, true); // paused
    let due = false;
    for (let i = 0; i < 6 && !due; i++) due = clock.tick((now += 1000), true, true);
    expect(due).toBe(true);
    expect(clock.take()).toBe(5); // 15 s elapsed, 5 of them playing and visible
    expect(clock.tick((now += 60_000), true, true)).toBe(false); // a long gap counts as one tick at most
    expect(clock.take()).toBe(2);
    expect(HEARTBEAT_MS).toBe(15_000);
  });
});

describe('settings and messaging', () => {
  it('parses the cached enforcement settings', () => {
    expect(parseEnforcement(undefined)).toEqual(DEFAULT_ENFORCEMENT);
    expect(parseEnforcement({ mode: 'soft', service_timeout_s: 100, block_shorts_feed: false })).toEqual({
      mode: 'soft',
      service_timeout_s: 30,
      decision_timeout_s: 45,
      block_shorts_feed: false,
    });
  });

  it('lets the content script reach the quota and gate endpoints only', () => {
    expect(ALLOWED_PATHS.test('/settings/enforcement')).toBe(true);
    expect(ALLOWED_PATHS.test('/quota/heartbeat')).toBe(true);
    expect(ALLOWED_PATHS.test(quotaTodayPath('AAAAAAAAAAA', 600.4, null))).toBe(true);
    expect(quotaTodayPath('AAAAAAAAAAA', 600.4, 12.6)).toBe('/quota/today?video_id=AAAAAAAAAAA&duration_s=600&position_s=13');
    expect(ALLOWED_PATHS.test('/settings/quota')).toBe(false);
    expect(ALLOWED_PATHS.test('/lock/login')).toBe(false);
    expect(isApiRequest({ type: 'bsd-api', method: 'PUT', path: '/settings/enforcement' })).toBe(false);
    expect(timeoutFor('/settings/enforcement', 6000)).toBe(6000);
    expect(timeoutFor('/verdicts/AAAAAAAAAAA')).toBe(120_000);
  });

  it('validates the custodian form', () => {
    expect(custodianFormError('', 'long enough', 'long enough')).toContain('nombre');
    expect(custodianFormError('Ana', 'short', 'short')).toContain('8');
    expect(custodianFormError('Ana', 'long enough', 'long enougH')).toContain('no coinciden');
    expect(custodianFormError('Ana', 'long enough', 'long enough')).toBeNull();
  });
});

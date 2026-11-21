// What the gate overlay shows for each gate state (pure, unit-tested; the DOM
// is in gate-overlay.ts). Every text is localised.
import { t } from '../options/i18n';
import type { GateDecision } from '../types';
import type { GateState } from './gate-state';
import { formatMinutes, formatPosition, usedFraction } from './quota-view';

export const START_COMMAND = 'cd service && uv run python -m app';

export type OverlayAction = 'retry' | 'back' | 'home' | 'dashboard' | 'dispute';
export type OverlayTone = 'deciding' | 'no' | 'limit' | 'error';

export interface OverlayModel {
  tone: OverlayTone;
  eyebrow: string;
  title: string;
  lead: string;
  detail: string | null;
  /** Shown as a command to copy (service not running). */
  command: string | null;
  /** Used fraction of the daily quota (quota screens). */
  meter: number | null;
  actions: OverlayAction[];
}

/** Why a verdict blocks, in the UI language. */
export function blockReason(gate: GateDecision | null): string {
  if (!gate) return t('gate.reason.unknown');
  if (gate.source === 'rule') {
    if (gate.rule === 'block_live') return t('gate.reason.live');
    if (gate.rule === 'block_ai_labeled') return t('gate.reason.ai');
    return t('gate.reason.channel');
  }
  return t('gate.reason.model', { pct: `${Math.round(gate.confidence * 100)} %` });
}

function model(tone: OverlayTone, title: string, lead: string, actions: OverlayAction[], extra: Partial<OverlayModel> = {}): OverlayModel {
  return { tone, eyebrow: t(tone === 'deciding' ? 'gate.eyebrow.deciding' : 'gate.eyebrow.blocked'), title, lead, detail: null, command: null, meter: null, actions, ...extra };
}

/** null: no overlay (the video may play). */
export function overlayModel(state: GateState): OverlayModel | null {
  switch (state.kind) {
    case 'off':
    case 'playing':
      return null;
    case 'deciding':
    case 'checking_quota':
      return model('deciding', t('gate.deciding.title'), t('gate.deciding.lead'), ['back']);
    case 'blocked':
      break;
  }
  const quota = state.quota;
  switch (state.reason) {
    case 'verdict':
      return model('no', t('gate.no.title'), blockReason(state.gate), ['dispute', 'back', 'home'], { detail: t('gate.no.detail') });
    case 'quota':
      return model('limit', t('gate.quota.title'), t('gate.quota.lead', { daily: formatMinutes(quota?.daily_s ?? 0) }), ['back', 'home', 'dashboard'], {
        detail: t('gate.quota.detail'),
        meter: quota ? usedFraction(quota) : 1,
      });
    case 'resume_tomorrow':
      return model('limit', t('gate.resume.title'), t('gate.resume.lead', { position: formatPosition(quota?.video?.resume_at_s ?? 0) }), ['back', 'home'], {
        detail: t('gate.quota.detail'),
        meter: quota ? usedFraction(quota) : 1,
      });
    case 'shorts_feed':
      return model('no', t('gate.shorts.title'), t('gate.shorts.lead'), ['back', 'home']);
    case 'unreachable':
      return model('error', t('gate.unreachable.title'), t('gate.unreachable.lead'), ['retry', 'back'], { command: START_COMMAND });
    case 'timeout':
      return model('error', t('gate.timeout.title'), t('gate.timeout.lead'), ['retry', 'back']);
    case 'error':
      return model('error', t('gate.error.title'), t('gate.error.lead'), ['retry', 'back'], { detail: state.detail });
  }
}

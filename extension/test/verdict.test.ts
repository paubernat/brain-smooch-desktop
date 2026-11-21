import { describe, expect, it } from 'vitest';
import { ALLOWED_PATHS, VERDICT_TIMEOUT_MS, timeoutFor } from '../src/api-messages';
import { describeConfig, judgeWarning } from '../src/options/live-settings';
import { parseRoute } from '../src/options/router';
import { initialTuneState } from '../src/options/tune-state';
import type { JudgesOut } from '../src/options/types';
import type { LiveVerdict } from '../src/types';
import { LabelPanel } from '../src/ui/label-panel';
import { needsReveal, verdictDisplay, verdictErrorMessage, type VerdictState } from '../src/ui/verdict-view';
import { installFakeDom } from './fake-dom';

function verdict(over: Partial<LiveVerdict> = {}): LiveVerdict {
  return {
    video_id: 'abcdefghijk',
    revealed: true,
    reveal: 'after_label',
    label: 'LIBRE',
    confidence: 0.874,
    probs: { NO: 0.05, LIMITADO: 0.08, LIBRE: 0.874 },
    source: 'model',
    rule: null,
    reason: null,
    judge: 'liquid/d1.2-ultra',
    config: 'D',
    partial: false,
    cached: false,
    cost_usd: 0.0001,
    latency_ms: 900,
    policy_version: '5-abc',
    ...over,
  };
}

const ready = (over: Partial<LiveVerdict> = {}): VerdictState => ({ kind: 'ready', verdict: verdict(over) });

describe('verdictDisplay', () => {
  it('shows label and rounded confidence with the tier color', () => {
    const d = verdictDisplay(ready(), null);
    expect(d.text).toBe('Modelo: LIBRE · 87 %');
    expect(d.tier).toBe('LIBRE');
    expect(d.match).toBeNull();
    expect(d.note).toBe('');
  });

  it('compares with the user label', () => {
    expect(verdictDisplay(ready(), 'LIBRE').match).toBe('yes');
    expect(verdictDisplay(ready(), 'NO').match).toBe('no');
  });

  it('notes the rule that decided', () => {
    const d = verdictDisplay(ready({ source: 'rule', rule: 'block_ai_labeled', label: 'NO', confidence: 1 }), null);
    expect(d.text).toBe('Modelo: NO · 100 %');
    expect(d.note).toBe('regla: IA');
    expect(verdictDisplay(ready({ source: 'rule', rule: 'block_live', label: 'NO' }), null).note).toBe('regla: directo');
  });

  it('keeps a hidden verdict hidden, without match', () => {
    const state = ready({ revealed: false, label: null, confidence: null, probs: null, source: null });
    const d = verdictDisplay(state, 'NO');
    expect(d.text).toBe('Modelo: oculto hasta que etiquetes');
    expect(d.match).toBeNull();
    expect(needsReveal(state)).toBe(true);
    expect(needsReveal(ready())).toBe(false);
  });

  it('has loading, error and idle states', () => {
    expect(verdictDisplay({ kind: 'loading' }, null).text).toBe('Modelo: pensando…');
    expect(verdictDisplay({ kind: 'error', message: 'falta la clave del juez' }, null)).toMatchObject({ tone: 'error', text: 'Modelo: falta la clave del juez' });
    expect(verdictDisplay({ kind: 'idle' }, null).text).toBe('');
    expect(verdictErrorMessage(503, 'x')).toBe('falta la clave del juez');
    expect(verdictErrorMessage(null, 'x')).toBe('servicio no disponible');
  });
});

describe('panel verdict section', () => {
  it('renders the verdict, updates the match on label and resets on video change', () => {
    const dom = installFakeDom();
    const panel = new LabelPanel({ onLabel: () => undefined, onRetry: () => undefined, onOpenSettings: () => undefined, onOpenCalibration: () => undefined });
    panel.mount();
    panel.setVideo('abcdefghijk', 'Un vídeo');
    const section = () => dom.documentElement.findAll((el) => el.classList.contains('verdict'))[0]!;
    expect(section().classList.contains('hidden')).toBe(true);
    panel.setVerdict(ready());
    expect(section().textContent).toBe('Modelo: LIBRE · 87 %');
    panel.setLabel({ label: 'NO', reason: null, labeled_at: 'x' });
    expect(section().textContent).toContain('✗ no coincide');
    panel.setVideo('bbbbbbbbbbb', 'Otro');
    expect(section().classList.contains('hidden')).toBe(true);
    expect(panel.verdictState()).toEqual({ kind: 'idle' });
  });
});

describe('verdict API plumbing', () => {
  it('allows the verdict path and gives it a long timeout', () => {
    expect(ALLOWED_PATHS.test('/verdicts/abcdefghijk')).toBe(true);
    expect(ALLOWED_PATHS.test('/verdicts/abc')).toBe(false);
    expect(ALLOWED_PATHS.test('/settings/live')).toBe(false); // only the options page changes settings
    expect(timeoutFor('/verdicts/abcdefghijk')).toBe(VERDICT_TIMEOUT_MS);
    expect(timeoutFor('/fichas')).toBeUndefined();
  });
});

describe('live judge settings and "Probar política"', () => {
  const judges: JudgesOut = {
    judges: [
      { key: 'liquid/d1.2-ultra', key_env: 'LIQUID_API_KEY', key_configured: true, input_per_mtok: 0.1, output_per_mtok: 0 },
      { key: 'openai/decisions', key_env: 'OPENAI_API_KEY', key_configured: false, input_per_mtok: 1, output_per_mtok: 0 },
    ],
    default_judge: 'liquid/d1.2-ultra',
    configs: [{ id: 'D', levels: 'L1+L2+L3' }],
    default_config: 'D',
  };

  it('describes configs in one line', () => {
    expect(describeConfig('D', 'L1+L2+L3')).toContain('canal + transcripción');
    expect(describeConfig('Z', 'L9')).toBe('Z · L9');
  });

  it('warns when the chosen judge has no key', () => {
    expect(judgeWarning({ judge: 'liquid/d1.2-ultra', config: 'D', reveal: 'after_label', min_confidence: 0.6 }, judges)).toBeNull();
    expect(judgeWarning({ judge: 'openai/decisions', config: 'D', reveal: 'always', min_confidence: 0.6 }, judges)).toContain('OPENAI_API_KEY');
    expect(judgeWarning({ judge: 'nope', config: 'D', reveal: 'always', min_confidence: 0.6 }, judges)).toContain('no está disponible');
  });

  it('routes #probar and starts a tuning session on a policy', () => {
    expect(parseRoute('#probar')).toBe('test');
    const state = initialTuneState(null);
    expect(state).toMatchObject({ draft: null, judge: null, config: 'D', evaluation: null });
  });
});

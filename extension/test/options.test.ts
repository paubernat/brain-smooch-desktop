import { describe, expect, it } from 'vitest';
import { percent, usd } from '../src/options/format';
import {
  formToPolicy,
  parseChannelList,
  policyToForm,
  samePolicy,
  slugifyAuxId,
  validateForm,
} from '../src/options/policy-form';
import { parseRoute } from '../src/options/router';
import type { EvalOutcome, JudgesOut, PolicyContent } from '../src/options/types';
import { acceptProposal, initialState, pickDefaultJudge, reachable, refineRequest, withDraft } from '../src/options/wizard/state';

const POLICY: PolicyContent = {
  question: {
    id: 'tier',
    type: 'choice',
    instructions: 'Clasifica este vídeo.\n',
    options: {
      NO: { description: 'League of Legends, NBA.' },
      LIMITADO: { description: 'Atrioc, dunkey. Ante la duda, LIMITADO.' },
      LIBRE: { description: 'Piano jazz, Azure.' },
    },
  },
  auxiliary_questions: [{ id: 'is_gaming', type: 'boolean', instructions: '¿Videojuegos?' }],
  channel_lists: { LIMITADO: ['Atrioc', 'dunkey'], LIBRE: ['Fireship'] },
};

function outcome(partial: Partial<EvalOutcome>): EvalOutcome {
  return {
    split: 'dev', policy_version: '4-abc', judge: 'liquid/d1.2', config: 'D', n_dev: 12, min_labels: 10,
    enough_labels: true, calls: 0, cached: 12, est_tokens: 0, est_cost_usd: 0, n: 12, accuracy: 0.75,
    macro_f1: 0.7, false_libre: 1, false_libre_rate: 0.1, failures: 0, new_calls: 0, cost_usd: 0, errors: [],
    ...partial,
  };
}

describe('policy form mapping', () => {
  it('round-trips a policy through the form', () => {
    const form = policyToForm(POLICY);
    expect(form.channels.LIMITADO).toBe('Atrioc, dunkey');
    expect(form.channels.NO).toBe('');
    const back = formToPolicy(form);
    expect(back.question.instructions).toBe('Clasifica este vídeo.');
    expect(back.channel_lists).toEqual({ NO: [], LIMITADO: ['Atrioc', 'dunkey'], LIBRE: ['Fireship'] });
    expect(back.auxiliary_questions).toEqual([{ id: 'is_gaming', type: 'boolean', instructions: '¿Videojuegos?' }]);
    expect(samePolicy(POLICY, back)).toBe(true);
  });

  it('parses channel lists from commas and lines, deduplicating', () => {
    expect(parseChannelList('Atrioc, dunkey\nLudwig,, atrioc \n')).toEqual(['Atrioc', 'dunkey', 'Ludwig']);
  });

  it('derives aux ids from the question and drops empty rows', () => {
    const form = policyToForm(POLICY);
    form.aux.push({ id: '', instructions: '¿Es de fútbol?' }, { id: '', instructions: '  ' });
    expect(formToPolicy(form).auxiliary_questions.map((a) => a.id)).toEqual(['is_gaming', 'es_de_futbol']);
    expect(slugifyAuxId('¿123 vídeos?')).toBe('q_123_videos');
  });

  it('validates required texts and aux ids', () => {
    const form = policyToForm(POLICY);
    expect(validateForm(form)).toEqual([]);
    form.options.LIBRE = ' ';
    form.aux.push({ id: 'Bad-Id', instructions: 'x' }, { id: 'is_gaming', instructions: 'y' });
    const errors = validateForm(form);
    expect(errors.some((e) => e.includes('LIBRE'))).toBe(true);
    expect(errors.some((e) => e.includes('Bad-Id'))).toBe(true);
    expect(errors.some((e) => e.includes('repetidas'))).toBe(true);
  });
});

describe('wizard state', () => {
  const judges: JudgesOut = {
    judges: [
      { key: 'liquid/d1.2', key_env: 'LIQUID_API_KEY', key_configured: false, input_per_mtok: 0.02, output_per_mtok: 0 },
      { key: 'openai/decisions', key_env: 'OPENAI_API_KEY', key_configured: true, input_per_mtok: 0.1, output_per_mtok: 0 },
    ],
    default_judge: null,
    configs: [{ id: 'D', levels: 'L1+L2+L3' }],
    default_config: 'D',
  };

  it('picks the service default, else the first judge with a key', () => {
    expect(pickDefaultJudge(judges)).toBe('openai/decisions');
    expect(pickDefaultJudge({ ...judges, default_judge: 'liquid/d1.2' })).toBe('liquid/d1.2');
    expect(pickDefaultJudge({ ...judges, judges: [] })).toBeNull();
  });

  it('only lets the user jump ahead once there is a draft', () => {
    const state = initialState();
    expect(reachable(state, 'tune')).toBe(false);
    expect(reachable(withDraft(state, POLICY), 'tune')).toBe(true);
  });

  it('builds the refine request from the evaluation errors', () => {
    const errors = [{ video_id: 'abc', title: 'NBA', channel: null, url: 'u', truth: 'NO' as const, predicted: 'LIBRE' as const, confidence: 0.8 }];
    const state = { ...withDraft(initialState(), POLICY), evaluation: outcome({ errors }) };
    const req = refineRequest(state);
    expect(req?.errors).toEqual([{ video_id: 'abc', predicted: 'LIBRE', confidence: 0.8 }]);
    expect(req?.snapshot).toEqual({ n: 12, accuracy: 0.75, false_libre: 1 });
    expect(req?.preferences).toBeNull();
    expect(refineRequest({ ...state, evaluation: outcome({ errors: [] }) })).toBeNull();
  });

  it('accepting a proposal replaces the draft and clears stale results', () => {
    const proposal = { content: { ...POLICY, auxiliary_questions: [] }, rationale: 'r', changelog: ['c'], usage: { model: 'm', input_tokens: 1, output_tokens: 1, cost_usd: null } };
    const state = { ...withDraft(initialState(), POLICY), evaluation: outcome({}), proposal };
    const next = acceptProposal(state);
    expect(next.draft).toBe(proposal.content);
    expect(next.evaluation).toBeNull();
    expect(next.proposal).toBeNull();
    expect(next.changelog).toEqual(['c']);
  });
});

describe('format and router', () => {
  it('formats percentages and dollars in Spanish style', () => {
    expect(percent(0.756)).toBe('76 %');
    expect(percent(null)).toBe('—');
    expect(usd(0.00123)).toBe('0,0012 $');
    expect(usd(1.5)).toBe('1,50 $');
  });

  it('parses hash routes', () => {
    expect(parseRoute('#manual')).toBe('manual');
    expect(parseRoute('#/agentica')).toBe('agentic');
    expect(parseRoute('')).toBe('landing');
  });
});

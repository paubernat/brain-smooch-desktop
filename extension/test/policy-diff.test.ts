import { describe, expect, it } from 'vitest';
import { ALLOWED_PATHS, FEEDBACK_SUMMARY_PATH } from '../src/api-messages';
import { diffPolicy, wordDiff } from '../src/options/policy-diff';
import { parseRoute } from '../src/options/router';
import type { PolicyContent } from '../src/options/types';
import { UndoStack } from '../src/options/undo';

const BASE: PolicyContent = {
  question: {
    id: 'tier',
    type: 'choice',
    instructions: 'Clasifica este vídeo.',
    options: {
      NO: { description: 'League of Legends, NBA.' },
      LIMITADO: { description: 'Atrioc, dunkey.' },
      LIBRE: { description: 'Piano jazz, Fireship.' },
    },
  },
  auxiliary_questions: [{ id: 'is_gaming', type: 'boolean', instructions: '¿Videojuegos?' }],
  channel_lists: { LIMITADO: ['Atrioc'], LIBRE: ['Fireship', 'DeepSeek'] },
};

function edited(change: (p: PolicyContent) => void): PolicyContent {
  const copy = structuredClone(BASE);
  change(copy);
  return copy;
}

describe('diffPolicy', () => {
  it('is empty for the same policy', () => {
    expect(diffPolicy(BASE, structuredClone(BASE))).toEqual([]);
  });

  it('lists only the changed fields, with before and after', () => {
    const after = edited((p) => {
      p.question.options.LIBRE.description = 'Piano jazz.';
      p.channel_lists.LIBRE = ['DeepSeek'];
    });
    expect(diffPolicy(BASE, after)).toEqual([
      { key: 'option.LIBRE', title: 'LIBRE', before: 'Piano jazz, Fireship.', after: 'Piano jazz.' },
      { key: 'channels.LIBRE', title: 'Canales LIBRE', before: 'Fireship, DeepSeek', after: 'DeepSeek' },
    ]);
  });

  it('detects auxiliary question changes', () => {
    const after = edited((p) => p.auxiliary_questions.push({ id: 'is_podcast', type: 'boolean', instructions: '¿Podcast?' }));
    expect(diffPolicy(BASE, after).map((c) => c.key)).toEqual(['aux']);
  });

  it('shows switched rules (missing rules = all off)', () => {
    const after = edited((p) => (p.rules = { block_ai_labeled: true, block_live: false }));
    expect(diffPolicy(BASE, after)).toEqual([
      { key: 'rules', title: 'Reglas fijas', before: '', after: '🚫 No a vídeos de IA (etiqueta de YouTube)' },
    ]);
    expect(diffPolicy(BASE, edited((p) => (p.rules = { block_ai_labeled: false, block_live: false })))).toEqual([]);
  });
});

describe('wordDiff', () => {
  it('marks removed and added words and rebuilds both texts', () => {
    const before = 'Piano jazz, Fireship o DeepSeek.';
    const after = 'Piano jazz o DeepSeek y podcasts.';
    const parts = wordDiff(before, after);
    const rebuild = (skip: 'add' | 'del') => parts.filter((p) => p.op !== skip).map((p) => p.text).join('');
    expect(rebuild('add')).toBe(before);
    expect(rebuild('del')).toBe(after);
    expect(parts.filter((p) => p.op === 'del').map((p) => p.text.trim())).toContain('jazz, Fireship');
    expect(parts.some((p) => p.op === 'add' && p.text.includes('podcasts.'))).toBe(true);
  });

  it('handles empty sides', () => {
    expect(wordDiff('', 'nuevo')).toEqual([{ op: 'add', text: 'nuevo' }]);
    expect(wordDiff('viejo', '')).toEqual([{ op: 'del', text: 'viejo' }]);
    expect(wordDiff('igual', 'igual')).toEqual([{ op: 'same', text: 'igual' }]);
  });
});

describe('UndoStack', () => {
  it('pops in reverse order and keeps at most `limit` items', () => {
    const stack = new UndoStack<number>(2);
    stack.push(1);
    stack.push(2);
    stack.push(3);
    expect(stack.size).toBe(2);
    expect(stack.pop()).toBe(3);
    expect(stack.pop()).toBe(2);
    expect(stack.pop()).toBeUndefined();
  });
});

describe('calibration wiring', () => {
  it('routes #calibracion and lets the panel read the pending summary', () => {
    expect(parseRoute('#calibracion')).toBe('calibration');
    expect(ALLOWED_PATHS.test(FEEDBACK_SUMMARY_PATH)).toBe(true);
    expect(ALLOWED_PATHS.test('/policy/refresh')).toBe(false);
  });
});

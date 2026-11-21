// Pure diff between two policies: which fields changed, and a word-level diff
// of each changed text (for the calibration and AI-edit views).
import { LABELS } from '../types';
import { formatChannelList } from './policy-form';
import type { PolicyContent } from './types';

export interface FieldChange {
  key: string;
  title: string;
  before: string;
  after: string;
}

export type DiffOp = 'same' | 'add' | 'del';

export interface DiffPart {
  op: DiffOp;
  text: string;
}

/** Above this many tokens per side, fall back to a whole-text replacement. */
const MAX_DIFF_TOKENS = 1500;

function auxText(policy: PolicyContent): string {
  return policy.auxiliary_questions.map((a) => `${a.id}: ${a.instructions ?? ''}`.trim()).join('\n');
}

/** The editable fields, in display order. */
function fields(policy: PolicyContent): FieldChange[] {
  const q = policy.question;
  return [
    { key: 'instructions', title: 'Instrucciones generales', before: '', after: q.instructions.trim() },
    ...LABELS.map((l) => ({ key: `option.${l}`, title: l, before: '', after: (q.options[l]?.description ?? '').trim() })),
    { key: 'aux', title: 'Preguntas auxiliares', before: '', after: auxText(policy) },
    ...LABELS.map((l) => ({ key: `channels.${l}`, title: `Canales ${l}`, before: '', after: formatChannelList(policy.channel_lists[l]) })),
  ];
}

export function diffPolicy(before: PolicyContent, after: PolicyContent): FieldChange[] {
  const old = new Map(fields(before).map((f) => [f.key, f.after]));
  return fields(after)
    .map((f) => ({ ...f, before: old.get(f.key) ?? '' }))
    .filter((f) => f.before !== f.after);
}

/** Words and the whitespace between them, so joining the parts gives back the text. */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

function push(parts: DiffPart[], op: DiffOp, text: string): void {
  const last = parts[parts.length - 1];
  if (last && last.op === op) last.text += text;
  else parts.push({ op, text });
}

/** Word-level diff (longest common subsequence). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_DIFF_TOKENS || b.length > MAX_DIFF_TOKENS) {
    const parts: DiffPart[] = [];
    if (before) push(parts, 'del', before);
    if (after) push(parts, 'add', after);
    return parts;
  }
  // lcs[i][j] = LCS length of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(parts, 'same', a[i++]!);
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      push(parts, 'del', a[i++]!);
    } else {
      push(parts, 'add', b[j++]!);
    }
  }
  while (i < a.length) push(parts, 'del', a[i++]!);
  while (j < b.length) push(parts, 'add', b[j++]!);
  return parts;
}

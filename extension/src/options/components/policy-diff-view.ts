// Before/after view of a policy change: one block per changed field with a
// word-level diff (deleted words struck through, added words highlighted).
import { h } from '../dom';
import { t } from '../i18n';
import { diffPolicy, wordDiff } from '../policy-diff';
import type { PolicyContent } from '../types';
import { notice } from './status';

function diffText(before: string, after: string): HTMLElement {
  const parts = wordDiff(before, after).map((p) => {
    if (p.op === 'add') return h('ins', { text: p.text });
    if (p.op === 'del') return h('del', { text: p.text });
    return h('span', { text: p.text });
  });
  return h('p', { className: 'diff-text pre' }, ...parts);
}

export function policyDiffView(before: PolicyContent, after: PolicyContent): HTMLElement {
  const changes = diffPolicy(before, after);
  if (!changes.length) return notice('info', t('diff.noChange'));
  return h(
    'div',
    { className: 'policy-diff' },
    ...changes.map((c) =>
      h('section', { className: 'diff-field' }, h('h4', { text: c.title }), diffText(c.before, c.after)),
    ),
  );
}

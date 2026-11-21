// Step 1: the user describes, in their own words, what goes in each tier.
import { optionsApi } from '../api';
import { tierHeader } from '../components/policy-editor';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, textarea } from '../dom';
import { t, type MessageKey } from '../i18n';
import type { TierTexts } from '../types';
import type { WizardContext } from './context';
import { hasPreferences, withDraft } from './state';

interface TierPrompt {
  key: keyof TierTexts;
  label: 'LIBRE' | 'LIMITADO' | 'NO';
  title: MessageKey;
  placeholder: MessageKey;
}

const TIERS: readonly TierPrompt[] = [
  { key: 'libre', label: 'LIBRE', title: 'describe.libre.title', placeholder: 'describe.libre.placeholder' },
  { key: 'limitado', label: 'LIMITADO', title: 'describe.limitado.title', placeholder: 'describe.limitado.placeholder' },
  { key: 'no', label: 'NO', title: 'describe.no.title', placeholder: 'describe.no.placeholder' },
];

export function renderDescribe(ctx: WizardContext): HTMLElement {
  const prefs = ctx.state.preferences;
  const status = h('div', { className: 'status-slot' });
  const persist = () => ctx.update({ ...ctx.state, preferences: prefs });

  const cards = TIERS.map((tier) => {
    const examples = h(
      'details',
      { className: 'examples' },
      h('summary', { text: t('describe.examples') }),
      textarea(prefs.examples[tier.key], t('describe.examplesPlaceholder'), 3, (v) => {
        prefs.examples[tier.key] = v;
        persist();
      }),
    );
    if (prefs.examples[tier.key].trim()) examples.open = true;
    return h(
      'section',
      { className: `tier-card tier-${tier.label}` },
      tierHeader(tier.label, t(tier.title)),
      textarea(prefs[tier.key], t(tier.placeholder), 7, (v) => {
        prefs[tier.key] = v;
        persist();
      }),
      examples,
    );
  });

  const generate = button(t('describe.generate'), () => void draft(), 'primary');
  async function draft(): Promise<void> {
    if (!hasPreferences(prefs)) {
      show(status, notice('warn', t('describe.writeSomething')));
      return;
    }
    generate.disabled = true;
    show(status, spinner(t('describe.drafting')));
    const res = await optionsApi.draft(prefs);
    generate.disabled = false;
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, t('describe.cannotDraft')));
      return;
    }
    const next = withDraft(ctx.state, res.data.content);
    ctx.update({ ...next, rationale: res.data.rationale, changelog: [] });
    ctx.goto('draft');
  }

  return h(
    'div',
    { className: 'step describe' },
    h('p', { className: 'lead', text: t('describe.lead') }),
    h('div', { className: 'tier-grid' }, ...cards),
    h(
      'div',
      { className: 'actions' },
      status,
      ctx.state.draft ? button(t('describe.toDraft'), () => ctx.goto('draft'), 'ghost') : null,
      generate,
    ),
  );
}

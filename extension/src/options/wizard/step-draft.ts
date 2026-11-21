// Step 2: the draft from Claude, editable, side by side with the user's text.
import { optionsApi } from '../api';
import { AiEditBox } from '../components/ai-edit';
import { PolicyEditor, TIER_INFO, tierBlurb, tierHeader } from '../components/policy-editor';
import { rationaleBox } from '../components/rationale';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { t } from '../i18n';
import { validateForm } from '../policy-form';
import type { Preferences, TierTexts } from '../types';
import type { WizardContext } from './context';
import { withDraft } from './state';

const PREF_KEY: Record<string, keyof TierTexts> = { LIBRE: 'libre', LIMITADO: 'limitado', NO: 'no' };

function userText(prefs: Preferences): HTMLElement {
  return h(
    'aside',
    { className: 'user-text' },
    h('h3', { text: t('draft.youWrote') }),
    ...TIER_INFO.map(({ label }) => {
      const key = PREF_KEY[label] ?? 'libre';
      const examples = prefs.examples[key].trim();
      return h(
        'section',
        { className: `quote tier-${label}` },
        tierHeader(label, tierBlurb(label)),
        h('p', { className: 'pre', text: prefs[key].trim() || t('common.empty') }),
        examples ? h('p', { className: 'pre muted small', text: t('draft.examples', { examples }) }) : null,
      );
    }),
  );
}

export function renderDraft(ctx: WizardContext): HTMLElement {
  const draft = ctx.state.draft;
  if (!draft) return h('div', {}, notice('warn', t('wizard.noDraft')), button(t('wizard.backDescribe'), () => ctx.goto('describe')));
  const status = h('div', { className: 'status-slot' });
  const editor = new PolicyEditor(draft, {
    showChannels: false,
    onChange: (policy) => ctx.update(withDraft(ctx.state, policy)),
  });
  const aiEdit = new AiEditBox({
    getPolicy: () => editor.getPolicy(),
    setPolicy: (policy) => {
      editor.setPolicy(policy);
      ctx.update(withDraft(ctx.state, policy));
    },
  });

  const regenerate = button(t('draft.regenerate'), () => void withBusy(regenerate, t('draft.regenerating'), async () => {
    show(status, spinner(t('draft.redrafting')));
    const res = await optionsApi.draft(ctx.state.preferences);
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, t('draft.cannotRegenerate')));
      return;
    }
    ctx.update({ ...withDraft(ctx.state, res.data.content), rationale: res.data.rationale, changelog: [] }, true);
  }));

  const next = (step: 'tune' | 'save') => () => {
    const problems = validateForm(editor.getForm());
    if (problems.length) {
      show(status, notice('warn', h('strong', { text: t('draft.review') }), h('ul', {}, ...problems.map((p) => h('li', { text: p })))));
      return;
    }
    ctx.goto(step);
  };

  return h(
    'div',
    { className: 'step draft' },
    rationaleBox(ctx.state.rationale, ctx.state.changelog),
    h('div', { className: 'side-by-side' }, userText(ctx.state.preferences), h('div', { className: 'draft-pane' }, h('div', { className: 'pane-head' }, h('h3', { text: t('draft.paneTitle') }), aiEdit.trigger), aiEdit.element, editor.element)),
    h(
      'div',
      { className: 'actions sticky' },
      status,
      button(t('wizard.backDescribe'), () => ctx.goto('describe'), 'ghost'),
      regenerate,
      button(t('draft.saveWithoutTuning'), next('save')),
      button(t('draft.tune'), next('tune'), 'primary'),
    ),
  );
}

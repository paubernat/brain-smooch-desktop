// Step 4: review the final draft and write it to policy/policy.yaml.
import { optionsApi } from '../api';
import { TIER_INFO, tierBlurb, tierHeader } from '../components/policy-editor';
import { errorNotice, notice, show } from '../components/status';
import { button, h, withBusy } from '../dom';
import { t } from '../i18n';
import { percent } from '../format';
import { rulesText } from '../policy-diff';
import { policyToForm, validateForm } from '../policy-form';
import { go, hrefFor } from '../router';
import type { PolicyContent } from '../types';
import type { WizardContext } from './context';
import { clearSaved } from './persist';

function preview(policy: PolicyContent): HTMLElement {
  const q = policy.question;
  const rules = rulesText(policy);
  return h(
    'div',
    { className: 'preview' },
    h('p', { className: 'pre', text: q.instructions }),
    h(
      'div',
      { className: 'tier-grid' },
      ...TIER_INFO.map(({ label }) => h('section', { className: `quote tier-${label}` }, tierHeader(label, tierBlurb(label)), h('p', { className: 'pre', text: q.options[label].description }))),
    ),
    h('p', { className: 'pre muted', text: rules ? t('save.rulesPrefix', { rules }) : t('save.noRules') }),
    policy.auxiliary_questions.length
      ? h(
          'ul',
          { className: 'aux-preview' },
          ...policy.auxiliary_questions.map((a) => h('li', {}, h('code', { text: a.id }), ` ${a.instructions ?? ''}`)),
        )
      : null,
  );
}

export function renderSave(ctx: WizardContext): HTMLElement {
  const draft = ctx.state.draft;
  if (!draft) return h('div', {}, notice('warn', t('wizard.noDraft')), button(t('wizard.backDescribe'), () => ctx.goto('describe')));
  const status = h('div', { className: 'status-slot' });
  const evaluation = ctx.state.evaluation;
  const problems = validateForm(policyToForm(draft));

  const save = button(t('save.save'), () => void withBusy(save, t('common.saving'), async () => {
    // Blocked sites have their own step (the wizard never edits them): keep what is on disk.
    const content = { ...draft, blocked_sites: ctx.policy.content.blocked_sites ?? [] };
    const res = await optionsApi.savePolicy({ content }, ctx.policy.version);
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, t('common.cannotSave')));
      return;
    }
    await clearSaved();
    ctx.saved();
    show(
      status,
      notice(
        'ok',
        h('strong', { text: t('common.policySavedVersion', { version: res.data.version }) }),
        h('p', { text: t('save.previousKept') }),
        h(
          'div',
          { className: 'actions inline' },
          h('a', { className: 'btn primary', text: t('common.next'), attrs: { href: hrefFor('sites') } }),
          button(t('save.openManual'), () => go('manual')),
          button(t('save.home'), () => go('landing'), 'ghost'),
        ),
      ),
    );
    save.remove();
  }), 'primary');
  save.disabled = problems.length > 0;

  return h(
    'div',
    { className: 'step save' },
    evaluation && evaluation.accuracy !== null
      ? notice('info', t('save.lastEval', { accuracy: percent(evaluation.accuracy), falseLibre: evaluation.false_libre }))
      : notice('info', t('save.notEvaluated')),
    problems.length ? notice('warn', h('ul', {}, ...problems.map((p) => h('li', { text: p })))) : null,
    preview(draft),
    h('p', { className: 'muted small', text: t('save.willBe', { version: ctx.policy.version + 1 }) }),
    h('div', { className: 'actions sticky' }, status, button(t('save.backTune'), () => ctx.goto('tune'), 'ghost'), save),
  );
}

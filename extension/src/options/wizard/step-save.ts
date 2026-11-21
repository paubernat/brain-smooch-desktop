// Step 4: review the final draft and write it to policy/policy.yaml.
import { optionsApi } from '../api';
import { TIER_INFO, tierHeader } from '../components/policy-editor';
import { errorNotice, notice, show } from '../components/status';
import { button, h, withBusy } from '../dom';
import { percent } from '../format';
import { rulesText } from '../policy-diff';
import { policyToForm, validateForm } from '../policy-form';
import { go } from '../router';
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
      ...TIER_INFO.map(({ label, blurb }) => h('section', { className: `quote tier-${label}` }, tierHeader(label, blurb), h('p', { className: 'pre', text: q.options[label].description }))),
    ),
    h('p', { className: 'pre muted', text: rules ? `Reglas fijas:\n${rules}` : 'Reglas fijas: ninguna.' }),
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
  if (!draft) return h('div', {}, notice('warn', 'Aún no hay borrador.'), button('← Describe', () => ctx.goto('describe')));
  const status = h('div', { className: 'status-slot' });
  const evaluation = ctx.state.evaluation;
  const problems = validateForm(policyToForm(draft));

  const save = button('Guardar política', () => void withBusy(save, 'Guardando…', async () => {
    const res = await optionsApi.savePolicy({ content: draft }, ctx.policy.version);
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, 'No se pudo guardar'));
      return;
    }
    await clearSaved();
    show(
      status,
      notice(
        'ok',
        h('strong', { text: `Política guardada como versión ${res.data.version}.` }),
        h('p', { text: 'La versión anterior queda en policy/history/. El juez usará la nueva a partir de ahora.' }),
        h('div', { className: 'actions inline' }, button('Abrir el editor manual', () => go('manual')), button('Volver al inicio', () => go('landing'), 'ghost')),
      ),
    );
    save.remove();
  }), 'primary');
  save.disabled = problems.length > 0;

  return h(
    'div',
    { className: 'step save' },
    evaluation && evaluation.accuracy !== null
      ? notice('info', `Última evaluación en dev: acierto ${percent(evaluation.accuracy)}, ${evaluation.false_libre} falsos LIBRE.`)
      : notice('info', 'Este borrador no se ha evaluado con tus etiquetas. Puedes guardarlo igualmente y afinarlo más adelante.'),
    problems.length ? notice('warn', h('ul', {}, ...problems.map((p) => h('li', { text: p })))) : null,
    preview(draft),
    h('p', { className: 'muted small', text: `Se guardará como versión ${ctx.policy.version + 1}. Las listas de canales se conservan (edítalas en el modo manual).` }),
    h('div', { className: 'actions sticky' }, status, button('← Afinar', () => ctx.goto('tune'), 'ghost'), save),
  );
}

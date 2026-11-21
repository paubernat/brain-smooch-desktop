// Step 2: the draft from Claude, editable, side by side with the user's text.
import { optionsApi } from '../api';
import { PolicyEditor, TIER_INFO, tierHeader } from '../components/policy-editor';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { validateForm } from '../policy-form';
import type { Preferences, TierTexts } from '../types';
import type { WizardContext } from './context';
import { withDraft } from './state';

const PREF_KEY: Record<string, keyof TierTexts> = { LIBRE: 'libre', LIMITADO: 'limitado', NO: 'no' };

export function rationaleBox(rationale: string, changelog: string[], title = 'Por qué este borrador'): HTMLElement | null {
  if (!rationale && !changelog.length) return null;
  return notice(
    'info',
    h('strong', { text: title }),
    rationale ? h('p', { text: rationale }) : '',
    changelog.length ? h('ul', { className: 'changelog' }, ...changelog.map((c) => h('li', { text: c }))) : '',
  );
}

function userText(prefs: Preferences): HTMLElement {
  return h(
    'aside',
    { className: 'user-text' },
    h('h3', { text: 'Lo que escribiste' }),
    ...TIER_INFO.map(({ label, blurb }) => {
      const key = PREF_KEY[label] ?? 'libre';
      const examples = prefs.examples[key].trim();
      return h(
        'section',
        { className: `quote tier-${label}` },
        tierHeader(label, blurb),
        h('p', { className: 'pre', text: prefs[key].trim() || '(vacío)' }),
        examples ? h('p', { className: 'pre muted small', text: `Ejemplos:\n${examples}` }) : null,
      );
    }),
  );
}

export function renderDraft(ctx: WizardContext): HTMLElement {
  const draft = ctx.state.draft;
  if (!draft) return h('div', {}, notice('warn', 'Aún no hay borrador.'), button('← Describe', () => ctx.goto('describe')));
  const status = h('div', { className: 'status-slot' });
  const editor = new PolicyEditor(draft, {
    showChannels: false,
    onChange: (policy) => ctx.update(withDraft(ctx.state, policy)),
  });

  const regenerate = button('Regenerar', () => void withBusy(regenerate, 'Regenerando…', async () => {
    show(status, spinner('Claude está redactando otra versión…'));
    const res = await optionsApi.draft(ctx.state.preferences);
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, 'No se pudo regenerar'));
      return;
    }
    ctx.update({ ...withDraft(ctx.state, res.data.content), rationale: res.data.rationale, changelog: [] }, true);
  }));

  const next = (step: 'tune' | 'save') => () => {
    const problems = validateForm(editor.getForm());
    if (problems.length) {
      show(status, notice('warn', h('strong', { text: 'Revisa el borrador:' }), h('ul', {}, ...problems.map((p) => h('li', { text: p })))));
      return;
    }
    ctx.goto(step);
  };

  return h(
    'div',
    { className: 'step draft' },
    rationaleBox(ctx.state.rationale, ctx.state.changelog),
    h('div', { className: 'side-by-side' }, userText(ctx.state.preferences), h('div', { className: 'draft-pane' }, h('h3', { text: 'Borrador de la política (editable)' }), editor.element)),
    h(
      'div',
      { className: 'actions sticky' },
      status,
      button('← Describe', () => ctx.goto('describe'), 'ghost'),
      regenerate,
      button('Guardar sin afinar', next('save')),
      button('Afinar con ejemplos →', next('tune'), 'primary'),
    ),
  );
}

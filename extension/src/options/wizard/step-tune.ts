// Step 3: evaluate the draft on the dev split, then improve it with Claude
// (the shared "Probar política" component on the wizard state).
import { DEV_ONLY_NOTE, mountTester } from '../components/policy-tester';
import { notice } from '../components/status';
import { button, h } from '../dom';
import type { WizardContext } from './context';

export function renderTune(ctx: WizardContext): HTMLElement {
  if (!ctx.state.draft) return h('div', {}, notice('warn', 'Aún no hay borrador.'), button('← Describe', () => ctx.goto('describe')));
  const body = h('div');
  const root = h('div', { className: 'step tune' }, notice('info', DEV_ONLY_NOTE), body, footer(ctx));
  void mountTester(body, ctx, { showEditor: true }, ctx.catalog(), [
    h('p', { text: 'Mientras tanto puedes guardar el borrador tal cual.' }),
    button('Saltar y guardar →', () => ctx.goto('save')),
  ]);
  return root;
}

function footer(ctx: WizardContext): HTMLElement {
  return h(
    'div',
    { className: 'actions sticky' },
    button('← Borrador', () => ctx.goto('draft'), 'ghost'),
    button('Guardar →', () => ctx.goto('save'), 'primary'),
  );
}

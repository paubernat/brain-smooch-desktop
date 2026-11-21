// Step 3: evaluate the draft on the dev split, then improve it with Claude
// (the shared "Probar política" component on the wizard state).
import { devOnlyNote, mountTester } from '../components/policy-tester';
import { notice } from '../components/status';
import { button, h } from '../dom';
import { t } from '../i18n';
import type { WizardContext } from './context';

export function renderTune(ctx: WizardContext): HTMLElement {
  if (!ctx.state.draft) return h('div', {}, notice('warn', t('wizard.noDraft')), button(t('wizard.backDescribe'), () => ctx.goto('describe')));
  const body = h('div');
  const root = h('div', { className: 'step tune' }, notice('info', devOnlyNote()), body, footer(ctx));
  void mountTester(body, ctx, { showEditor: true }, ctx.catalog(), [
    h('p', { text: t('tune.meanwhile') }),
    button(t('tune.skip'), () => ctx.goto('save')),
  ]);
  return root;
}

function footer(ctx: WizardContext): HTMLElement {
  return h(
    'div',
    { className: 'actions sticky' },
    button(t('tune.backDraft'), () => ctx.goto('draft'), 'ghost'),
    button(t('tune.toSave'), () => ctx.goto('save'), 'primary'),
  );
}

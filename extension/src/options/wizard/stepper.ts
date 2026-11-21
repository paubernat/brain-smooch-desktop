// Step indicator: numbered pills; done and reachable steps are clickable.
import { h } from '../dom';
import { t } from '../i18n';
import { STEPS, reachable, type StepId, type WizardState } from './state';

export function renderStepper(state: WizardState, goto: (step: StepId) => void): HTMLElement {
  const current = STEPS.findIndex((s) => s.id === state.step);
  return h(
    'ol',
    { className: 'stepper', attrs: { 'aria-label': t('nav.steps') } },
    ...STEPS.map((step, i) => {
      const status = i < current ? 'done' : i === current ? 'current' : 'todo';
      const canGo = i !== current && reachable(state, step.id);
      const item = h(
        'li',
        { className: `step-item ${status}${canGo ? ' clickable' : ''}` },
        h('span', { className: 'step-num mono', text: status === 'done' ? '✓' : String(i + 1).padStart(2, '0') }),
        h('span', { className: 'step-title', text: t(step.title) }),
      );
      if (i === current) item.setAttribute('aria-current', 'step');
      if (canGo) {
        item.tabIndex = 0;
        item.addEventListener('click', () => goto(step.id));
        item.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') goto(step.id);
        });
      }
      return item;
    }),
  );
}

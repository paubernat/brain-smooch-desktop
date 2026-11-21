// Step indicator: numbered pills; done and reachable steps are clickable.
import { h } from '../dom';
import { STEPS, reachable, type StepId, type WizardState } from './state';

export function renderStepper(state: WizardState, goto: (step: StepId) => void): HTMLElement {
  const current = STEPS.findIndex((s) => s.id === state.step);
  return h(
    'ol',
    { className: 'stepper', attrs: { 'aria-label': 'Pasos' } },
    ...STEPS.map((step, i) => {
      const status = i < current ? 'done' : i === current ? 'current' : 'todo';
      const canGo = i !== current && reachable(state, step.id);
      const item = h(
        'li',
        { className: `step-item ${status}${canGo ? ' clickable' : ''}` },
        h('span', { className: 'step-num', text: status === 'done' ? '✓' : String(i + 1) }),
        h('span', { className: 'step-title', text: step.title }),
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

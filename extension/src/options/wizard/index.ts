// Agentic wizard controller: holds the state, renders the stepper and the current step.
import { optionsApi } from '../api';
import { viewHeader } from '../components/header';
import { errorNotice, show, spinner } from '../components/status';
import { button, h } from '../dom';
import type { PolicyOut } from '../types';
import type { WizardContext } from './context';
import { loadSaved, saveSoon } from './persist';
import { initialState, type StepId, type WizardState } from './state';
import { renderDescribe } from './step-describe';
import { renderDraft } from './step-draft';
import { renderSave } from './step-save';
import { renderTune } from './step-tune';
import { renderStepper } from './stepper';

const STEP_VIEWS: Record<StepId, (ctx: WizardContext) => HTMLElement> = {
  describe: renderDescribe,
  draft: renderDraft,
  tune: renderTune,
  save: renderSave,
};

export function renderWizard(): HTMLElement {
  const body = h('div', {}, spinner('Preparando el asistente…'));
  const root = h(
    'div',
    { className: 'view wizard' },
    viewHeader('Configuración agéntica', 'Describe lo que quieres, revisa el borrador que escribe la IA y afínalo con los vídeos que ya has etiquetado.'),
    body,
  );
  void start(body);
  return root;
}

async function start(body: HTMLElement): Promise<void> {
  const [policy, saved] = await Promise.all([optionsApi.getPolicy(), loadSaved()]);
  if (!policy.ok) {
    show(body, errorNotice(policy.error, policy.status, 'No se pudo leer la política'), button('Reintentar', () => {
      show(body, spinner('Preparando el asistente…'));
      void start(body);
    }));
    return;
  }
  const state: WizardState = { ...initialState(), ...saved };
  if (!state.draft && state.step !== 'describe') state.step = 'describe';
  new WizardController(body, policy.data, state).render();
}

class WizardController implements WizardContext {
  private readonly stepperSlot = h('nav', { className: 'stepper-slot' });
  private readonly stepSlot = h('div', { className: 'step-slot' });
  private catalogPromise: ReturnType<WizardContext['catalog']> | null = null;

  constructor(body: HTMLElement, readonly policy: PolicyOut, private current: WizardState) {
    body.replaceChildren(this.stepperSlot, this.stepSlot);
  }

  get state(): WizardState {
    return this.current;
  }

  update(next: WizardState, rerender = false): void {
    this.current = next;
    saveSoon(next);
    if (rerender) this.render();
  }

  goto(step: StepId): void {
    this.update({ ...this.current, step }, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  catalog(): ReturnType<WizardContext['catalog']> {
    this.catalogPromise ??= Promise.all([optionsApi.judges(), optionsApi.labelStats()]).then(([judges, stats]) => {
      if (!judges.ok) return { error: judges.error, status: judges.status };
      if (!stats.ok) return { error: stats.error, status: stats.status };
      return { judges: judges.data, stats: stats.data };
    });
    const pending = this.catalogPromise;
    void pending.then((c) => {
      if ('error' in c) this.catalogPromise = null; // retry next time
    });
    return pending;
  }

  render(): void {
    this.stepperSlot.replaceChildren(renderStepper(this.current, (step) => this.goto(step)));
    this.stepSlot.replaceChildren(STEP_VIEWS[this.current.step](this));
  }
}

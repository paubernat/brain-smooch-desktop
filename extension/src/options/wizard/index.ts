// Agentic wizard controller: holds the state, renders the stepper and the current step.
import { optionsApi } from '../api';
import { viewHeader } from '../components/header';
import { loadTuneCatalog } from '../components/policy-tester';
import { Statue } from '../components/statue';
import { errorNotice, show, spinner } from '../components/status';
import { button, h } from '../dom';
import { t } from '../i18n';
import { raiseLight, wizardLight } from '../progress';
import { loadSetup, markPolicySaved, raiseStatue } from '../setup-state';
import type { PolicyOut } from '../types';
import type { WizardContext } from './context';
import { loadSaved, saveSoon } from './persist';
import { initialState, wizardMilestones, type StepId, type WizardState } from './state';
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
  const body = h('div', {}, spinner(t('wizard.preparing')));
  const statue = new Statue('robot', 0, 'small');
  const root = h('div', { className: 'view wizard' }, viewHeader(t('wizard.title'), t('wizard.lead'), '02', statue.element), body);
  void start(body, statue);
  return root;
}

async function start(body: HTMLElement, statue: Statue): Promise<void> {
  const [policy, saved, setup] = await Promise.all([optionsApi.getPolicy(), loadSaved(), loadSetup()]);
  statue.setLight(setup.light.agentic, false);
  if (!policy.ok) {
    show(body, errorNotice(policy.error, policy.status, t('common.cannotReadPolicy')), button(t('common.retry'), () => {
      show(body, spinner(t('wizard.preparing')));
      void start(body, statue);
    }));
    return;
  }
  const state: WizardState = { ...initialState(), ...saved };
  if (!state.draft && state.step !== 'describe') state.step = 'describe';
  new WizardController(body, policy.data, state, statue, setup.light.agentic).render();
}

class WizardController implements WizardContext {
  private readonly stepperSlot = h('nav', { className: 'stepper-slot' });
  private readonly stepSlot = h('div', { className: 'step-slot' });
  private catalogPromise: ReturnType<WizardContext['catalog']> | null = null;

  constructor(
    body: HTMLElement,
    readonly policy: PolicyOut,
    private current: WizardState,
    private readonly statue: Statue,
    private light: number,
  ) {
    body.replaceChildren(this.stepperSlot, this.stepSlot);
    this.progress(false);
  }

  /** Light the robot for the milestones reached (never dims). */
  private progress(saved: boolean): void {
    const next = raiseLight(this.light, wizardLight(wizardMilestones(this.current, saved)));
    if (next === this.light) return;
    this.light = next;
    this.statue.setLight(next);
    void (saved ? markPolicySaved('agentic') : raiseStatue('agentic', next));
  }

  saved(): void {
    this.progress(true);
  }

  get state(): WizardState {
    return this.current;
  }

  update(next: WizardState, rerender = false): void {
    this.current = next;
    saveSoon(next);
    this.progress(false);
    if (rerender) this.render();
  }

  goto(step: StepId): void {
    this.update({ ...this.current, step }, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  catalog(): ReturnType<WizardContext['catalog']> {
    this.catalogPromise ??= loadTuneCatalog();
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

// Pure state of the agentic wizard (no DOM): steps and defaults. The tuning
// part (judge, config, evaluation, proposal) lives in ../tune-state.ts.
import type { MessageKey } from '../i18n';
import { hasPreferences, initialTuneState, type TuneState } from '../tune-state';
import type { WizardMilestones } from '../progress';

export {
  MIN_DEV_LABELS,
  acceptProposal,
  emptyPreferences,
  hasPreferences,
  pickDefaultJudge,
  refineRequest,
  withDraft,
} from '../tune-state';

export type StepId = 'describe' | 'draft' | 'tune' | 'save';

export const STEPS: readonly { id: StepId; title: MessageKey }[] = [
  { id: 'describe', title: 'wizard.step.describe' },
  { id: 'draft', title: 'wizard.step.draft' },
  { id: 'tune', title: 'wizard.step.tune' },
  { id: 'save', title: 'wizard.step.save' },
];

export interface WizardState extends TuneState {
  step: StepId;
}

export function initialState(): WizardState {
  return { step: 'describe', ...initialTuneState() };
}

/** Progress of the wizard for the robot statue (saving is tracked by the caller). */
export function wizardMilestones(state: WizardState, saved: boolean): WizardMilestones {
  const drafted = state.draft !== null;
  return {
    described: hasPreferences(state.preferences),
    drafted,
    tuned: drafted && (state.evaluation !== null || state.step === 'tune' || state.step === 'save'),
    saved,
  };
}

/** Steps the user can jump to from the step indicator. */
export function reachable(state: WizardState, step: StepId): boolean {
  if (step === 'describe') return true;
  return state.draft !== null;
}

// Pure state of the agentic wizard (no DOM): steps and defaults. The tuning
// part (judge, config, evaluation, proposal) lives in ../tune-state.ts.
import { initialTuneState, type TuneState } from '../tune-state';

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

export const STEPS: readonly { id: StepId; title: string }[] = [
  { id: 'describe', title: 'Describe' },
  { id: 'draft', title: 'Borrador' },
  { id: 'tune', title: 'Afinar con ejemplos' },
  { id: 'save', title: 'Guardar' },
];

export interface WizardState extends TuneState {
  step: StepId;
}

export function initialState(): WizardState {
  return { step: 'describe', ...initialTuneState() };
}

/** Steps the user can jump to from the step indicator. */
export function reachable(state: WizardState, step: StepId): boolean {
  if (step === 'describe') return true;
  return state.draft !== null;
}

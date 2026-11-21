// Pure state of the agentic wizard (no DOM): steps, defaults and payloads.
import type { RefineRequest } from '../api';
import type { EvalOutcome, JudgesOut, PolicyContent, Preferences, RefineResult } from '../types';

export type StepId = 'describe' | 'draft' | 'tune' | 'save';

export const STEPS: readonly { id: StepId; title: string }[] = [
  { id: 'describe', title: 'Describe' },
  { id: 'draft', title: 'Borrador' },
  { id: 'tune', title: 'Afinar con ejemplos' },
  { id: 'save', title: 'Guardar' },
];

export const MIN_DEV_LABELS = 10;

export interface WizardState {
  step: StepId;
  preferences: Preferences;
  draft: PolicyContent | null;
  rationale: string;
  changelog: string[];
  judge: string | null;
  config: string;
  estimate: EvalOutcome | null;
  evaluation: EvalOutcome | null;
  proposal: RefineResult | null;
}

export function emptyPreferences(): Preferences {
  return { libre: '', limitado: '', no: '', examples: { libre: '', limitado: '', no: '' } };
}

export function initialState(): WizardState {
  return {
    step: 'describe',
    preferences: emptyPreferences(),
    draft: null,
    rationale: '',
    changelog: [],
    judge: null,
    config: 'D',
    estimate: null,
    evaluation: null,
    proposal: null,
  };
}

export function hasPreferences(p: Preferences): boolean {
  return [p.libre, p.limitado, p.no].some((t) => t.trim().length > 0);
}

/** Steps the user can jump to from the step indicator. */
export function reachable(state: WizardState, step: StepId): boolean {
  if (step === 'describe') return true;
  return state.draft !== null;
}

/** Service default (cheapest judge with a key), else the first judge with a key. */
export function pickDefaultJudge(judges: JudgesOut): string | null {
  if (judges.default_judge) return judges.default_judge;
  return judges.judges.find((j) => j.key_configured)?.key ?? null;
}

/** Any change to the draft makes earlier estimates and results stale. */
export function withDraft(state: WizardState, draft: PolicyContent): WizardState {
  return { ...state, draft, estimate: null, evaluation: null, proposal: null };
}

export function acceptProposal(state: WizardState): WizardState {
  if (!state.proposal) return state;
  const next = withDraft(state, state.proposal.content);
  return { ...next, rationale: state.proposal.rationale, changelog: state.proposal.changelog };
}

export function refineRequest(state: WizardState): RefineRequest | null {
  const result = state.evaluation;
  if (!state.draft || !result || result.errors.length === 0) return null;
  return {
    draft: state.draft,
    errors: result.errors.map(({ video_id, predicted, confidence }) => ({ video_id, predicted, confidence })),
    config: state.config,
    preferences: hasPreferences(state.preferences) ? state.preferences : null,
    snapshot: result.accuracy === null ? null : { n: result.n, accuracy: result.accuracy, false_libre: result.false_libre },
  };
}

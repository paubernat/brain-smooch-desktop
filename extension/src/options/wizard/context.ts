// What every wizard step receives from the controller.
import type { TuneCatalog } from '../components/policy-tester';
import type { PolicyOut } from '../types';
import type { StepId, WizardState } from './state';

export interface WizardContext {
  readonly state: WizardState;
  /** Policy currently saved on disk (for expected_version and the channel lists). */
  readonly policy: PolicyOut;
  /** Replace the state; re-render the current step only when asked. */
  update(next: WizardState, rerender?: boolean): void;
  goto(step: StepId): void;
  /** The policy was saved from the wizard: light the robot fully. */
  saved(): void;
  /** Loaded once per wizard session (step 3). */
  catalog(): Promise<TuneCatalog>;
}

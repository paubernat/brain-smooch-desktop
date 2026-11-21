// Typed client for the options page. The page runs on the extension origin
// (moz-extension://), which the service allows by CORS, so it fetches directly.
import type { ApiResult } from '../api-messages';
import { fetchService } from '../service-http';
import type { FeedbackSummary, LiveSettings } from '../types';
import type {
  DraftResult,
  EditResult,
  EvalOutcome,
  FeedbackRef,
  HistoryEntry,
  JudgesOut,
  LabelStats,
  Misclassified,
  PolicyContent,
  PolicyOut,
  Preferences,
  RefineResult,
  RefreshResult,
} from './types';

const LLM_TIMEOUT_MS = 4 * 60_000; // Claude drafting can take a while
const EVAL_TIMEOUT_MS = 15 * 60_000; // a full dev evaluation with retries

export interface EvaluateRequest {
  content: PolicyContent;
  judge: string;
  config: string;
  dry_run: boolean;
}

export interface RefineRequest {
  draft: PolicyContent;
  errors: Pick<Misclassified, 'video_id' | 'predicted' | 'confidence'>[];
  config: string;
  preferences: Preferences | null;
  snapshot: { n: number; accuracy: number; false_libre: number } | null;
}

export const optionsApi = {
  health: () => fetchService<{ status: string }>('GET', '/health', undefined, 3000),
  getPolicy: () => fetchService<PolicyOut>('GET', '/policy'),
  history: () => fetchService<HistoryEntry[]>('GET', '/policy/history'),
  /** `incorporate`: labels used by /policy/refresh, marked as incorporated on save. */
  savePolicy: (body: { content: PolicyContent } | { yaml: string }, expectedVersion?: number, incorporate: FeedbackRef[] = []) =>
    fetchService<PolicyOut>('PUT', '/policy', { ...body, expected_version: expectedVersion ?? null, incorporate }),
  draft: (preferences: Preferences) =>
    fetchService<DraftResult>('POST', '/policy/draft', { preferences }, LLM_TIMEOUT_MS),
  evaluate: (req: EvaluateRequest): Promise<ApiResult<EvalOutcome>> =>
    fetchService<EvalOutcome>('POST', '/policy/evaluate', req, req.dry_run ? undefined : EVAL_TIMEOUT_MS),
  refine: (req: RefineRequest) => fetchService<RefineResult>('POST', '/policy/refine', req, LLM_TIMEOUT_MS),
  feedback: () => fetchService<FeedbackSummary>('GET', '/policy/feedback'),
  refresh: (config?: string) => fetchService<RefreshResult>('POST', '/policy/refresh', config ? { config } : {}, LLM_TIMEOUT_MS),
  edit: (policy: PolicyContent, instruction: string) =>
    fetchService<EditResult>('POST', '/policy/edit', { policy, instruction }, LLM_TIMEOUT_MS),
  judges: () => fetchService<JudgesOut>('GET', '/judges'),
  labelStats: () => fetchService<LabelStats>('GET', '/labels/stats'),
  liveSettings: () => fetchService<LiveSettings>('GET', '/settings/live'),
  saveLiveSettings: (settings: LiveSettings) => fetchService<LiveSettings>('PUT', '/settings/live', settings),
};

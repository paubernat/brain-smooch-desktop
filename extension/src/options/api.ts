// Typed client for the options page. The page runs on the extension origin
// (moz-extension://), which the service allows by CORS, so it fetches directly.
import type { ApiResult } from '../api-messages';
import { fetchService } from '../service-http';
import type {
  DraftResult,
  EvalOutcome,
  HistoryEntry,
  JudgesOut,
  LabelStats,
  Misclassified,
  PolicyContent,
  PolicyOut,
  Preferences,
  RefineResult,
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
  savePolicy: (body: { content: PolicyContent } | { yaml: string }, expectedVersion?: number) =>
    fetchService<PolicyOut>('PUT', '/policy', { ...body, expected_version: expectedVersion ?? null }),
  draft: (preferences: Preferences) =>
    fetchService<DraftResult>('POST', '/policy/draft', { preferences }, LLM_TIMEOUT_MS),
  evaluate: (req: EvaluateRequest): Promise<ApiResult<EvalOutcome>> =>
    fetchService<EvalOutcome>('POST', '/policy/evaluate', req, req.dry_run ? undefined : EVAL_TIMEOUT_MS),
  refine: (req: RefineRequest) => fetchService<RefineResult>('POST', '/policy/refine', req, LLM_TIMEOUT_MS),
  judges: () => fetchService<JudgesOut>('GET', '/judges'),
  labelStats: () => fetchService<LabelStats>('GET', '/labels/stats'),
};

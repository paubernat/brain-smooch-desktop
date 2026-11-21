// Shapes of the /policy*, /judges and /labels/stats endpoints (docs/api-contract.md).
import type { Label } from '../types';

export interface AuxQuestion {
  id: string;
  type?: 'boolean';
  instructions: string | null;
}

/** Fixed rules applied before the model in production (not in the ablation). */
export interface PolicyRules {
  /** NO to videos with YouTube's creator-disclosed "altered or synthetic content" label. */
  block_ai_labeled: boolean;
  /** NO to live streams in progress and scheduled ones (recordings: the model decides). */
  block_live: boolean;
}

export interface PolicyContent {
  question: {
    id: string;
    type?: 'choice';
    instructions: string;
    options: Record<Label, { description: string }>;
  };
  auxiliary_questions: AuxQuestion[];
  channel_lists: Partial<Record<Label, string[]>>;
  /** Absent on services older than the rules (defaults: all off). */
  rules?: PolicyRules;
}

export interface PolicyOut {
  version: number;
  policy_version: string;
  content: PolicyContent;
  yaml: string;
  /** Labels marked as incorporated by this save (PUT only). */
  incorporated?: number;
}

export interface HistoryEntry {
  version: number;
  file: string;
  saved_at: string;
}

export interface TierTexts {
  libre: string;
  limitado: string;
  no: string;
}

export interface Preferences extends TierTexts {
  examples: TierTexts;
}

export interface AuthorUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
}

export interface DraftResult {
  content: PolicyContent;
  rationale: string;
  usage: AuthorUsage;
}

export interface RefineResult extends DraftResult {
  changelog: string[];
}

/** One exact label (re-labelling changes `labeled_at`). */
export interface FeedbackRef {
  video_id: string;
  labeled_at: string;
}

/** Proposal from the pending labels; `feedback` is what gets marked on save. */
export interface RefreshResult extends RefineResult {
  base_version: number;
  feedback: FeedbackRef[];
}

export interface EditResult {
  content: PolicyContent;
  changelog: string;
  usage: AuthorUsage;
}

export interface JudgeInfo {
  key: string;
  key_env: string;
  key_configured: boolean;
  input_per_mtok: number | null;
  output_per_mtok: number | null;
}

export interface JudgesOut {
  judges: JudgeInfo[];
  default_judge: string | null;
  configs: { id: string; levels: string }[];
  default_config: string;
}

export interface Misclassified {
  video_id: string;
  title: string;
  channel: string | null;
  url: string;
  truth: Label;
  predicted: Label;
  confidence: number;
}

export interface EvalOutcome {
  split: 'dev';
  policy_version: string;
  judge: string;
  config: string;
  n_dev: number;
  min_labels: number;
  enough_labels: boolean;
  calls: number;
  cached: number;
  est_tokens: number;
  est_cost_usd: number;
  n: number;
  accuracy: number | null;
  macro_f1: number | null;
  false_libre: number;
  false_libre_rate: number | null;
  failures: number;
  new_calls: number;
  cost_usd: number;
  errors: Misclassified[];
}

export interface LabelStats {
  total: number;
  by_split: { dev: number; test: number };
}

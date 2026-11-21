// Shapes of the extension <-> service contract (docs/api-contract.md).

export type Label = 'NO' | 'LIMITADO' | 'LIBRE';
export const LABELS: readonly Label[] = ['NO', 'LIMITADO', 'LIBRE'];

export type TranscriptStatus = 'ok' | 'none' | 'blocked';
export type TrackKind = 'manual' | 'asr';

export interface Chapter {
  start_s: number;
  title: string;
}

/** Where the creator-disclosed AI label was looked for (see extract/ai-disclosure.ts). */
export type AiDisclosureSource = 'next' | 'reel' | 'dom' | 'unknown';

/**
 * YouTube's "Altered or synthetic content" label ("How this was made" section).
 * `source: 'unknown'` means no response was found: `labeled` says nothing then.
 */
export interface AiDisclosure {
  labeled: boolean;
  source: AiDisclosureSource;
  text?: string;
}

/** Live-stream state from the player response (see extract/live.ts). */
export interface LiveInfo {
  is_live_now: boolean;
  /** Recording of a finished live stream. */
  was_live: boolean;
  /** Scheduled live stream or premiere. */
  is_upcoming: boolean;
}

export interface Metadata {
  title: string;
  description_raw: string;
  keywords: string[];
  category: string | null;
  duration_s: number;
  is_short: boolean;
  chapters: Chapter[];
  channel_id: string;
  channel_name: string;
  publish_date: string | null;
  is_family_safe: boolean | null;
  game: string | null;
  ai_disclosure: AiDisclosure;
  live: LiveInfo;
}

export interface TranscriptSegment {
  start_s: number;
  text: string;
}

export interface Transcript {
  status: TranscriptStatus;
  language: string | null;
  kind: TrackKind | null;
  segments: TranscriptSegment[];
}

export interface StoryboardLevelGeometry {
  width: number;
  height: number;
  frame_count: number;
  columns: number;
  rows: number;
  interval_ms: number;
}

export interface Storyboard {
  thumbnail_url: string;
  level: StoryboardLevelGeometry;
  sprite_urls: string[];
}

export interface FichaPayload {
  video_id: string;
  url: string;
  metadata: Metadata;
  transcript: Transcript;
  storyboard: Storyboard | null;
}

export type L2Status = 'ok' | 'pending' | 'error';
export type L4Status = 'ok' | 'pending' | 'none' | 'error';

export interface LevelStatus {
  L1: 'ok';
  L2: L2Status;
  L3: TranscriptStatus;
  L4: L4Status;
}

export interface LabelInfo {
  label: Label;
  reason: string | null;
  labeled_at: string;
  split?: 'dev' | 'test';
}

export interface FichaResponse {
  video_id: string;
  levels: LevelStatus;
  label: LabelInfo | null;
  [key: string]: unknown;
}

export interface LabelRequest {
  video_id: string;
  label: Label;
  reason?: string;
}

export interface LabelResponse {
  video_id: string;
  label: Label;
  reason: string | null;
  split: 'dev' | 'test';
  labeled_at: string;
}

/** A label not yet incorporated into the policy (GET /policy/feedback). */
export interface FeedbackItem {
  video_id: string;
  title: string;
  channel: string | null;
  label: Label;
  reason: string | null;
  is_short: boolean;
  labeled_at: string;
}

/** Pending labels: only the dev split feeds a policy refresh; test is shown as info. */
export interface FeedbackSummary {
  split: 'dev';
  pending: number;
  by_label: Record<Label, number>;
  with_reason: number;
  pending_test: number;
  hint_threshold: number;
  items: FeedbackItem[];
}

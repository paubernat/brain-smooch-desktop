// Shapes of the extension <-> service contract (docs/api-contract.md).

export type Label = 'NO' | 'LIMITADO' | 'LIBRE';
export const LABELS: readonly Label[] = ['NO', 'LIMITADO', 'LIBRE'];

export type TranscriptStatus = 'ok' | 'none' | 'blocked';
export type TrackKind = 'manual' | 'asr';

export interface Chapter {
  start_s: number;
  title: string;
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

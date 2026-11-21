// Pure mapping from setup progress to how much of a statue is lit (unit-tested).
// Light goes 0 → 0.25 → 0.5 → 0.75 → 1; the five segments of a statue ignite
// in order (base, legs, torso, arms, head) and the head (eyes) only at 100 %.
import type { PolicyContent } from './types';

export const STATUE_SEGMENTS = ['base', 'legs', 'torso', 'arms', 'head'] as const;
export type StatueSegment = (typeof STATUE_SEGMENTS)[number];
export type Light = 0 | 0.25 | 0.5 | 0.75 | 1;

export interface WizardMilestones {
  /** Something written in at least one tier. */
  described: boolean;
  /** A draft exists. */
  drafted: boolean;
  /** Reached the tuning step or evaluated the draft. */
  tuned: boolean;
  /** The policy was saved from the wizard. */
  saved: boolean;
}

export interface ManualMilestones {
  instructions: boolean;
  /** The three tier descriptions are filled in. */
  tiers: boolean;
  /** Rules, auxiliary questions or channel lists set. */
  extras: boolean;
  saved: boolean;
}

/** Which manual sections a policy already completes (saving is tracked separately). */
export function manualMilestonesOf(p: PolicyContent): Omit<ManualMilestones, 'saved'> {
  const options = p.question.options;
  const lists = p.channel_lists;
  return {
    instructions: p.question.instructions.trim().length > 0,
    tiers: (['LIBRE', 'LIMITADO', 'NO'] as const).every((l) => (options[l]?.description ?? '').trim().length > 0),
    extras:
      p.auxiliary_questions.length > 0 ||
      Object.values(lists).some((names) => (names ?? []).length > 0) ||
      p.rules?.block_ai_labeled === true ||
      p.rules?.block_live === true,
  };
}

/** Highest milestone reached: describe 25 %, draft 50 %, tune 75 %, save 100 %. */
export function wizardLight(m: WizardMilestones): Light {
  if (m.saved) return 1;
  if (m.tuned) return 0.75;
  if (m.drafted) return 0.5;
  if (m.described) return 0.25;
  return 0;
}

/** Each completed section adds 25 %; saving lights the whole statue. */
export function manualLight(m: ManualMilestones): Light {
  if (m.saved) return 1;
  const done = [m.instructions, m.tiers, m.extras].filter(Boolean).length;
  return (done * 0.25) as Light;
}

/** Segments lit at a light level: segment i needs (i + 1) / 5 (head only at 100 %). */
export function litSegments(light: number): StatueSegment[] {
  return STATUE_SEGMENTS.filter((_, i) => light + 1e-9 >= (i + 1) / STATUE_SEGMENTS.length);
}

/** Light never goes down while configuring (stored as the maximum reached). */
export function raiseLight(previous: number, next: number): number {
  return Math.min(1, Math.max(previous, next));
}

export function lightPercent(light: number): string {
  return `${Math.round(light * 100)} %`;
}

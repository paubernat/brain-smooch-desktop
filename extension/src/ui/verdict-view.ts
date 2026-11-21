// What the label panel shows for the live verdict (pure: no DOM, unit-tested).
import type { Label, LiveVerdict } from '../types';

export type VerdictState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; verdict: LiveVerdict };

export interface VerdictDisplay {
  text: string;
  /** Colors the text like the label buttons; null = neutral. */
  tier: Label | null;
  tone: 'muted' | 'error' | 'tier';
  /** "regla: IA" / "regla: directo" / "regla: canal" when a fixed rule decided. */
  note: string;
  /** Compared with the user's label once both exist. */
  match: 'yes' | 'no' | null;
  title: string;
}

const RULE_NOTES: Record<NonNullable<LiveVerdict['rule']>, string> = {
  block_ai_labeled: 'regla: IA',
  block_live: 'regla: directo',
  channel_list: 'regla: canal',
};

/** Error text for a failed verdict request (HTTP status from the service). */
export function verdictErrorMessage(status: number | null, error: string): string {
  if (status === 503) return 'falta la clave del juez';
  if (status === 502) return 'el juez ha fallado';
  if (status === null) return 'servicio no disponible';
  return error;
}

export function roundPercent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export function verdictDisplay(state: VerdictState, myLabel: Label | null): VerdictDisplay {
  const base = { tier: null, note: '', match: null, title: '' } as const;
  switch (state.kind) {
    case 'idle':
      return { ...base, text: '', tone: 'muted' };
    case 'loading':
      return { ...base, text: 'Modelo: pensando…', tone: 'muted' };
    case 'error':
      return { ...base, text: `Modelo: ${state.message}`, tone: 'error', title: state.message };
  }
  const v = state.verdict;
  const title = `${v.judge} · config ${v.config}${v.partial ? ' · faltaban niveles' : ''}${v.cached ? ' · caché' : ''}`;
  if (!v.revealed || !v.label) return { ...base, text: 'Modelo: oculto hasta que etiquetes', tone: 'muted', title };
  const confidence = v.confidence === null ? '' : ` · ${roundPercent(v.confidence)}`;
  return {
    text: `Modelo: ${v.label}${confidence}`,
    tier: v.label,
    tone: 'tier',
    note: v.source === 'rule' && v.rule ? RULE_NOTES[v.rule] : '',
    match: myLabel === null ? null : myLabel === v.label ? 'yes' : 'no',
    title: v.reason ? `${v.reason} · ${title}` : title,
  };
}

/** The verdict is still hidden: after labelling, the panel asks for it again. */
export function needsReveal(state: VerdictState): boolean {
  return state.kind === 'ready' && !state.verdict.revealed;
}

// Pure mapping between the policy (service JSON) and the editor form.
import { LABELS, type Label } from '../types';
import type { PolicyContent } from './types';

export interface AuxRow {
  id: string;
  instructions: string;
}

export interface PolicyForm {
  questionId: string;
  instructions: string;
  options: Record<Label, string>;
  aux: AuxRow[];
  /** Channel names, comma or newline separated, as typed by the user. */
  channels: Record<Label, string>;
}

const AUX_ID = /^[a-z][a-z0-9_]*$/;

function byLabel<T>(fn: (label: Label) => T): Record<Label, T> {
  return Object.fromEntries(LABELS.map((l) => [l, fn(l)])) as Record<Label, T>;
}

export function parseChannelList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function formatChannelList(names: readonly string[] | undefined): string {
  return (names ?? []).join(', ');
}

/** "¿Es de videojuegos?" -> "es_de_videojuegos" (ASCII snake_case). */
export function slugifyAuxId(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(slug) ? slug : slug ? `q_${slug}` : '';
}

export function policyToForm(policy: PolicyContent): PolicyForm {
  return {
    questionId: policy.question.id,
    instructions: policy.question.instructions.trim(),
    options: byLabel((l) => policy.question.options[l]?.description.trim() ?? ''),
    aux: policy.auxiliary_questions.map((a) => ({ id: a.id, instructions: a.instructions ?? '' })),
    channels: byLabel((l) => formatChannelList(policy.channel_lists[l])),
  };
}

export function formToPolicy(form: PolicyForm): PolicyContent {
  return {
    question: {
      id: form.questionId || 'tier',
      type: 'choice',
      instructions: form.instructions.trim(),
      options: byLabel((l) => ({ description: form.options[l].trim() })),
    },
    auxiliary_questions: form.aux
      .filter((a) => a.id.trim() || a.instructions.trim())
      .map((a) => ({
        id: a.id.trim() || slugifyAuxId(a.instructions),
        type: 'boolean' as const,
        instructions: a.instructions.trim() || null,
      })),
    channel_lists: byLabel((l) => parseChannelList(form.channels[l])),
  };
}

/** Problems that would make the service reject the policy, in Spanish. */
export function validateForm(form: PolicyForm): string[] {
  const errors: string[] = [];
  if (!form.instructions.trim()) errors.push('Faltan las instrucciones generales.');
  for (const label of LABELS) {
    if (!form.options[label].trim()) errors.push(`Falta la descripción de ${label}.`);
  }
  const ids = formToPolicy(form).auxiliary_questions.map((a) => a.id);
  for (const id of ids) {
    if (!AUX_ID.test(id)) errors.push(`Identificador de pregunta auxiliar no válido: «${id || '(vacío)'}» (usa minúsculas_y_guiones_bajos).`);
  }
  const dupes = ids.filter((id, i) => id && ids.indexOf(id) !== i);
  if (dupes.length) errors.push(`Preguntas auxiliares repetidas: ${[...new Set(dupes)].join(', ')}.`);
  return errors;
}

export function samePolicy(a: PolicyContent, b: PolicyContent): boolean {
  return JSON.stringify(formToPolicy(policyToForm(a))) === JSON.stringify(formToPolicy(policyToForm(b)));
}

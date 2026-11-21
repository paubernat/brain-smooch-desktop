// Pure mapping between the policy (service JSON) and the editor form.
import { completeLists } from '../channel-lists';
import { LABELS, type Label } from '../types';
import { t, type MessageKey } from './i18n';
import type { PolicyContent, PolicyRules } from './types';

export interface AuxRow {
  id: string;
  instructions: string;
}

export interface PolicyForm {
  questionId: string;
  instructions: string;
  options: Record<Label, string>;
  aux: AuxRow[];
  /** Channel names per tier (edited with the channel board). */
  channels: Record<Label, string[]>;
  rules: PolicyRules;
  /** Not edited in the form (see the "Block extra sites" step); kept as is on save. */
  blockedSites: string[];
}

export const DEFAULT_RULES: Readonly<PolicyRules> = Object.freeze({ block_ai_labeled: false, block_live: false });

/** The rule switches of the profile page, in display order (texts in the i18n catalogues). */
export const RULE_SWITCHES: readonly { key: keyof PolicyRules; title: MessageKey; note: MessageKey }[] = [
  { key: 'block_ai_labeled', title: 'rules.block_ai_labeled.title', note: 'rules.block_ai_labeled.note' },
  { key: 'block_live', title: 'rules.block_live.title', note: 'rules.block_live.note' },
];

export function normalizeRules(rules: Partial<PolicyRules> | undefined): PolicyRules {
  return { block_ai_labeled: rules?.block_ai_labeled === true, block_live: rules?.block_live === true };
}

const AUX_ID = /^[a-z][a-z0-9_]*$/;

function byLabel<T>(fn: (label: Label) => T): Record<Label, T> {
  return Object.fromEntries(LABELS.map((l) => [l, fn(l)])) as Record<Label, T>;
}

/** Names typed or pasted with commas or line breaks, trimmed and de-duplicated (case-insensitive). */
export function parseChannelList(text: string): string[] {
  return cleanChannelList(text.split(/[\n,]/));
}

export function cleanChannelList(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
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
  const channels = completeLists(policy.channel_lists);
  return {
    questionId: policy.question.id,
    instructions: policy.question.instructions.trim(),
    options: byLabel((l) => policy.question.options[l]?.description.trim() ?? ''),
    aux: policy.auxiliary_questions.map((a) => ({ id: a.id, instructions: a.instructions ?? '' })),
    channels: byLabel((l) => cleanChannelList(channels[l])),
    rules: normalizeRules(policy.rules),
    blockedSites: [...(policy.blocked_sites ?? [])],
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
    channel_lists: byLabel((l) => cleanChannelList(form.channels[l])),
    rules: { ...form.rules },
    blocked_sites: [...form.blockedSites],
  };
}

/** Problems that would make the service reject the policy, in the UI language. */
export function validateForm(form: PolicyForm): string[] {
  const errors: string[] = [];
  if (!form.instructions.trim()) errors.push(t('form.missingInstructions'));
  for (const label of LABELS) {
    if (!form.options[label].trim()) errors.push(t('form.missingOption', { label }));
  }
  const ids = formToPolicy(form).auxiliary_questions.map((a) => a.id);
  for (const id of ids) {
    if (!AUX_ID.test(id)) errors.push(t('form.badAuxId', { id: id || t('common.empty') }));
  }
  const dupes = ids.filter((id, i) => id && ids.indexOf(id) !== i);
  if (dupes.length) errors.push(t('form.dupAux', { ids: [...new Set(dupes)].join(', ') }));
  return errors;
}

export function samePolicy(a: PolicyContent, b: PolicyContent): boolean {
  return JSON.stringify(formToPolicy(policyToForm(a))) === JSON.stringify(formToPolicy(policyToForm(b)));
}

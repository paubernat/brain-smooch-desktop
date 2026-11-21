// Tier badge + blurb header, shared by the editor, the wizard and the channel board.
import { LABELS, type Label } from '../../types';
import { h } from '../dom';
import { t, type MessageKey } from '../i18n';

const BLURB_KEYS: Readonly<Record<Label, MessageKey>> = {
  LIBRE: 'editor.tier.LIBRE',
  LIMITADO: 'editor.tier.LIMITADO',
  NO: 'editor.tier.NO',
};

/** Display order: LIBRE, LIMITADO, NO. */
export const TIER_INFO: readonly { label: Label }[] = [...LABELS].reverse().map((label) => ({ label }));

export function tierBlurb(label: Label): string {
  return t(BLURB_KEYS[label]);
}

export function tierHeader(label: Label, blurb: string = tierBlurb(label)): HTMLElement {
  return h('header', {}, h('span', { className: `tier-badge tier-${label}`, text: label }), h('span', { className: 'muted', text: blurb }));
}

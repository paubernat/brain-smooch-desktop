// Channel lists of the policy (`channel_lists`: NO / LIMITADO / LIBRE ->
// channel names). Names match case-insensitively (like service/app/rules.py)
// and a name lives in at most one list. Pure; shared by the options page and
// the YouTube label panel.
import { LABELS, type Label } from './types';

export type ChannelLists = Partial<Record<Label, string[]>>;

export function sameChannel(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** The list a channel is in, or null. */
export function channelTier(lists: ChannelLists, name: string): Label | null {
  if (!name.trim()) return null;
  return LABELS.find((label) => (lists[label] ?? []).some((c) => sameChannel(c, name))) ?? null;
}

/** All three lists present (empty when missing). */
export function completeLists(lists: ChannelLists): Record<Label, string[]> {
  return { NO: [...(lists.NO ?? [])], LIMITADO: [...(lists.LIMITADO ?? [])], LIBRE: [...(lists.LIBRE ?? [])] };
}

/** Removes the channel from every list. */
export function withoutChannel(lists: ChannelLists, name: string): Record<Label, string[]> {
  const out = completeLists(lists);
  for (const label of LABELS) out[label] = out[label].filter((c) => !sameChannel(c, name));
  return out;
}

/** Puts the channel in `tier` (moving it out of any other list); `null` removes it. */
export function withChannel(lists: ChannelLists, name: string, tier: Label | null): Record<Label, string[]> {
  const clean = name.trim();
  const out = withoutChannel(lists, clean);
  if (tier && clean) out[tier].push(clean);
  return out;
}

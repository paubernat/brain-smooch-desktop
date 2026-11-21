// Channel lists as three tier-coloured chip lists: add by name, remove, move
// between tiers. A name lives in one list only (adding it to another tier moves it).
import { channelTier, completeLists, withChannel, type ChannelLists } from '../../channel-lists';
import { LABELS, type Label } from '../../types';
import { button, h } from '../dom';
import { t } from '../i18n';
import { ChipList } from './chip-list';
import { tierHeader } from './tier';

export class ChannelBoard {
  readonly element: HTMLElement;
  private lists: Record<Label, string[]>;
  private readonly chipLists = new Map<Label, ChipList>();

  constructor(lists: ChannelLists, private readonly onChange: (lists: Record<Label, string[]>) => void) {
    this.lists = completeLists(lists);
    const columns = LABELS.map((label) => {
      const chips = new ChipList({
        inputLabel: t('channels.inputLabel', { label }),
        placeholder: t('channels.placeholder'),
        addLabel: t('common.add'),
        emptyText: t('channels.empty', { label }),
        separator: /[\n,]/,
        add: (raw) => this.add(label, raw),
      });
      this.chipLists.set(label, chips);
      return h('section', { className: `tier-card channel-column tier-${label}` }, tierHeader(label), chips.element);
    });
    this.element = h('div', { className: 'tier-grid channel-board' }, ...columns);
    this.render();
  }

  getLists(): Record<Label, string[]> {
    return completeLists(this.lists);
  }

  setLists(lists: ChannelLists): void {
    this.lists = completeLists(lists);
    this.render();
  }

  private add(label: Label, raw: string): string | null {
    const name = raw.trim();
    if (!name) return t('channels.writeName');
    const from = channelTier(this.lists, name);
    if (from === label) return t('channels.duplicate', { name, label });
    this.update(withChannel(this.lists, name, label));
    return from ? t('channels.moved', { name, from, to: label }) : null;
  }

  private update(next: Record<Label, string[]>): void {
    this.lists = next;
    this.render();
    this.onChange(this.getLists());
  }

  private render(): void {
    for (const label of LABELS) {
      this.chipLists.get(label)?.render(
        this.lists[label].map((name) => ({
          value: name,
          removeLabel: t('channels.remove', { name }),
          onRemove: () => this.update(withChannel(this.lists, name, null)),
          actions: LABELS.filter((other) => other !== label).map((other) => {
            const move = button(other.slice(0, 3), () => this.update(withChannel(this.lists, name, other)), 'ghost');
            move.className = `chip-move tier-${other}`;
            move.title = t('channels.moveTo', { label: other });
            move.setAttribute('aria-label', `${t('channels.moveTo', { label: other })}: ${name}`);
            return move;
          }),
        })),
      );
    }
  }
}

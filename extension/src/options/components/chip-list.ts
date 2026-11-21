// Chip list with an "add" input: used for blocked sites and channel lists.
// The parent owns the items: `add` validates and stores a value (returning an
// error message or null) and `render` redraws the chips.
import { button, h } from '../dom';

export interface Chip {
  value: string;
  removeLabel: string;
  onRemove: () => void;
  /** Extra small buttons inside the chip (e.g. "move to another tier"). */
  actions?: HTMLElement[];
}

export interface ChipListProps {
  inputLabel: string;
  placeholder: string;
  addLabel: string;
  emptyText: string;
  /** Several values can be pasted at once, separated by this. */
  separator: RegExp;
  add: (raw: string) => string | null;
  className?: string;
}

export class ChipList {
  readonly element: HTMLElement;
  private readonly list = h('ul', { className: 'chips', attrs: { role: 'list' } });
  private readonly input: HTMLInputElement;
  private readonly error = h('p', { className: 'chip-error', attrs: { role: 'alert' } });

  constructor(private readonly props: ChipListProps) {
    this.input = h('input', { attrs: { type: 'text', placeholder: props.placeholder, 'aria-label': props.inputLabel, autocomplete: 'off', spellcheck: 'false' } });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      }
    });
    this.input.addEventListener('input', () => {
      this.error.textContent = '';
    });
    const add = button(props.addLabel, () => this.submit(), 'primary');
    this.element = h(
      'div',
      { className: `chip-list ${props.className ?? ''}` },
      h('div', { className: 'chip-input' }, this.input, add),
      this.error,
      this.list,
    );
  }

  focus(): void {
    this.input.focus();
  }

  render(chips: Chip[]): void {
    if (!chips.length) {
      this.list.replaceChildren(h('li', { className: 'chip-empty muted small', text: this.props.emptyText }));
      return;
    }
    this.list.replaceChildren(
      ...chips.map((chip) => {
        const remove = button('✕', chip.onRemove, 'ghost');
        remove.classList.add('chip-remove');
        remove.setAttribute('aria-label', chip.removeLabel);
        remove.title = chip.removeLabel;
        return h('li', { className: 'chip' }, h('span', { className: 'chip-text', text: chip.value }), ...(chip.actions ?? []), remove);
      }),
    );
  }

  private submit(): void {
    const parts = this.input.value.split(this.props.separator).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) parts.push('');
    const errors: string[] = [];
    const rejected: string[] = [];
    for (const part of parts) {
      const problem = this.props.add(part);
      if (problem) {
        errors.push(problem);
        if (part) rejected.push(part);
      }
    }
    this.error.textContent = errors.join(' ');
    this.input.value = rejected.join(', ');
    this.input.focus();
  }
}

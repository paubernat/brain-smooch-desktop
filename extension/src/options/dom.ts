// Tiny DOM builder (no innerHTML: keeps web-ext lint quiet and avoids injection).

export type Child = Node | string | null | undefined | false;

export interface Props {
  className?: string;
  text?: string;
  attrs?: Record<string, string>;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.className) el.className = props.className;
  if (props.text) el.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) el.setAttribute(name, value);
  append(el, ...children);
  return el;
}

export function append(parent: Node, ...children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function button(text: string, onClick: () => void, variant: 'primary' | 'secondary' | 'ghost' = 'secondary'): HTMLButtonElement {
  const b = h('button', { className: `btn ${variant}`, text, attrs: { type: 'button' } });
  b.addEventListener('click', onClick);
  return b;
}

export function textarea(value: string, placeholder: string, rows: number, onInput: (value: string) => void): HTMLTextAreaElement {
  const el = h('textarea', { attrs: { rows: String(rows), placeholder, spellcheck: 'true' } });
  el.value = value;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('label', { className: 'field' }, h('span', { className: 'field-label', text: label }), control, hint ? h('span', { className: 'hint', text: hint }) : null);
}

/** Disable a button while an async action runs, showing a busy label. */
export async function withBusy<T>(btn: HTMLButtonElement, busyText: string, action: () => Promise<T>): Promise<T> {
  const original = btn.textContent ?? '';
  btn.disabled = true;
  btn.classList.add('busy');
  btn.textContent = busyText;
  try {
    return await action();
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
    btn.textContent = original;
  }
}

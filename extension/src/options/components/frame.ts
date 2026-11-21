// Framed panels with corner marks and a big index number (the page's visual unit).
import { h, type Child } from '../dom';

export function corners(): HTMLElement[] {
  return ['tl', 'tr', 'bl', 'br'].map((pos) => h('span', { className: `corner ${pos}`, attrs: { 'aria-hidden': 'true' } }));
}

export interface SquareProps {
  index: string;
  title: string;
  text: string;
  cta: string;
  art: Node;
  tone: 'green' | 'orange' | 'dual';
  /** Link target; omitted for squares that act on click. */
  href?: string;
  onClick?: () => void;
  locked?: boolean;
  lockedText?: string;
  extra?: Child;
}

/** A numbered square card: index on top, art in the middle, title and call to action below. */
export function square(p: SquareProps): HTMLElement {
  const tag = p.href && !p.locked ? 'a' : 'button';
  const el = h(
    tag,
    { className: `square tone-${p.tone}${p.locked ? ' locked' : ''}` },
    ...corners(),
    h('span', { className: 'square-index', text: p.index, attrs: { 'aria-hidden': 'true' } }),
    h('div', { className: 'square-art' }, p.art),
    h(
      'div',
      { className: 'square-foot' },
      h('h2', { className: 'square-title', text: p.title }),
      h('p', { className: 'square-text', text: p.locked && p.lockedText ? p.lockedText : p.text }),
      h('span', { className: 'square-cta', text: p.locked ? '🔒 ' + p.cta.replace(/\s*→\s*$/, '') : p.cta }),
    ),
    p.extra,
  );
  if (el instanceof HTMLAnchorElement && p.href) el.href = p.href;
  if (el instanceof HTMLButtonElement) {
    el.type = 'button';
    el.disabled = p.locked === true;
    el.setAttribute('aria-disabled', String(p.locked === true));
    if (p.onClick) el.addEventListener('click', p.onClick);
  }
  return el;
}

/** Wide framed strip (pre-launch steps, tools). */
export function panel(className: string, ...children: Child[]): HTMLElement {
  return h('section', { className: `panel-frame ${className}` }, ...corners(), ...children);
}

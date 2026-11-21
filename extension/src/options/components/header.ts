// Header of the manual and agentic views.
import { h } from '../dom';
import { hrefFor } from '../router';

export function viewHeader(title: string, lead: string): HTMLElement {
  return h(
    'header',
    { className: 'view-header' },
    h('a', { className: 'back', text: '← Inicio', attrs: { href: hrefFor('landing') } }),
    h('h1', { text: title }),
    h('p', { className: 'lead', text: lead }),
  );
}

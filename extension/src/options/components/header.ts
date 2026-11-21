// Header of the inner views: back link, eyebrow, display title, lead and an
// optional piece of art (the statue that lights up as the setup progresses).
import { h } from '../dom';
import { t } from '../i18n';
import { hrefFor } from '../router';

export function viewHeader(title: string, lead: string, eyebrow?: string, art?: HTMLElement): HTMLElement {
  return h(
    'header',
    { className: `view-header${art ? ' with-art' : ''}` },
    h(
      'div',
      { className: 'view-header-text' },
      h('a', { className: 'back mono', text: t('nav.home'), attrs: { href: hrefFor('landing') } }),
      eyebrow ? h('p', { className: 'eyebrow mono', text: eyebrow }) : null,
      h('h1', { className: 'display', text: title }),
      h('p', { className: 'lead', text: lead }),
    ),
    art ?? null,
  );
}

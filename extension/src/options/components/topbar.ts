// Fixed top bar: brand mark, current section index and the language toggle.
import { h } from '../dom';
import { t } from '../i18n';
import { hrefFor } from '../router';
import { langSwitch } from './lang-switch';

export function topBar(): HTMLElement {
  const brand = h('a', { className: 'brand', attrs: { href: hrefFor('landing') } }, h('span', { className: 'brand-mark', attrs: { 'aria-hidden': 'true' } }), h('span', { className: 'brand-name', text: t('nav.brand') }));
  return h('header', { className: 'topbar' }, brand, h('span', { className: 'topbar-rule', attrs: { 'aria-hidden': 'true' } }), langSwitch());
}

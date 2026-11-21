// Recovery kit (#kit): a printable page for the custodian. Name, date, what
// the password unlocks and how to use it, and blank lines where the password
// is written BY HAND. The password (and its hash) are never printed: the
// service does not have the password and never sends the hash.
import { errorNotice, formatWhen, show, spinner } from '../components/status';
import { button, h } from '../dom';
import { t } from '../i18n';
import { lockApi, type LockStatus } from '../lock-client';
import { hrefFor } from '../router';

export function renderRecoveryKit(): HTMLElement {
  const body = h('div', {}, spinner(t('lock.loading')));
  void load(body);
  return h('div', { className: 'view kit' }, body);
}

async function load(body: HTMLElement): Promise<void> {
  const res = await lockApi.status();
  if (!res.ok) return show(body, errorNotice(res.error, res.status, t('lock.cannotRead')));
  show(body, kit(res.data));
}

function writeLine(label: string): HTMLElement {
  return h('div', { className: 'kit-line' }, h('span', { className: 'kit-line-label', text: label }), h('span', { className: 'kit-line-blank', attrs: { 'aria-hidden': 'true' } }));
}

function section(title: string, ...items: string[]): HTMLElement {
  return h('section', { className: 'kit-section' }, h('h2', { text: title }), h('ol', {}, ...items.map((text) => h('li', { text }))));
}

export function kit(status: LockStatus): HTMLElement {
  const url = `${location.origin}/${hrefFor('lock')}`;
  return h(
    'article',
    { className: 'kit-sheet' },
    h('div', { className: 'kit-toolbar no-print' }, button(t('kit.print'), () => window.print(), 'primary'), h('a', { className: 'btn ghost', text: t('nav.home'), attrs: { href: hrefFor('landing') } })),
    h('p', { className: 'eyebrow mono', text: t('kit.eyebrow') }),
    h('h1', { className: 'display', text: t('kit.title') }),
    h(
      'dl',
      { className: 'kit-meta' },
      h('dt', { text: t('kit.custodian') }),
      h('dd', { text: status.custodian || '—' }),
      h('dt', { text: t('kit.created') }),
      h('dd', { text: status.created_at ? formatWhen(status.created_at) : '—' }),
      h('dt', { text: t('kit.printed') }),
      h('dd', { text: formatWhen(new Date().toISOString()) }),
    ),
    h('p', { className: 'lead', text: t('kit.intro') }),
    h('section', { className: 'kit-section' }, h('h2', { text: t('kit.password.title') }), h('p', { text: t('kit.password.text') }), writeLine(t('kit.password.app')), writeLine(t('kit.password.windows'))),
    section(t('kit.relax.title'), t('kit.relax.1', { url }), t('kit.relax.2'), t('kit.relax.3')),
    section(t('kit.forgot.title'), t('kit.forgot.1'), t('kit.forgot.2')),
    section(t('kit.uninstall.title'), t('kit.uninstall.1'), t('kit.uninstall.2'), t('kit.uninstall.3')),
    h('p', { className: 'kit-warning', text: t('kit.keep') }),
  );
}

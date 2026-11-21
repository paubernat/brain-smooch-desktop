// Block page (blocked.html?site=<domain>&url=<original url>): the background
// redirects top-level navigations to a blocked site here. Same neon style and
// language as the profile page.
import { corners } from '../options/components/frame';
import { h } from '../options/dom';
import { currentLang, initLang, t } from '../options/i18n';
import { localWebUrl } from '../service-http';
import { normalizeDomain } from '../sites';

/** Only show a domain that is valid (the query string is user-controllable). */
function blockedDomain(): string | null {
  const raw = new URLSearchParams(location.search).get('site') ?? '';
  const result = normalizeDomain(raw);
  return result.ok ? result.domain : null;
}

async function start(): Promise<void> {
  await initLang();
  document.documentElement.lang = currentLang();
  document.title = t('title.blocked');
  const domain = blockedDomain() ?? t('blocked.unknown');
  const back = h('button', { className: 'btn secondary', text: t('blocked.back'), attrs: { type: 'button' } });
  back.addEventListener('click', () => history.back());
  const profile = h('a', { className: 'btn primary', text: t('blocked.profile'), attrs: { href: await localWebUrl('webs') } });
  const lead = t('blocked.lead').split('{domain}'); // the domain goes in its own element
  document.getElementById('app')?.replaceChildren(
    h(
      'section',
      { className: 'blocked-card view-enter' },
      ...corners(),
      h('span', { className: 'square-index', text: '403', attrs: { 'aria-hidden': 'true' } }),
      h('p', { className: 'eyebrow mono', text: t('blocked.eyebrow') }),
      h('h1', { className: 'display glitch', text: t('blocked.title') }),
      h('p', { className: 'lead' }, lead[0] ?? '', h('strong', { className: 'blocked-domain mono', text: domain }), lead[1] ?? ''),
      h('p', { className: 'muted', text: t('blocked.why') }),
      h('div', { className: 'actions inline' }, back, profile),
    ),
  );
}

void start();

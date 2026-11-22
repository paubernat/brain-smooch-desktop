// "System active": shown on the landing once the rocket was launched. Live
// judge, blocked sites, pinned channels, pending labels and shortcuts to
// reopen every part of the setup.
import { formatMinutes } from '../../enforce/quota-view';
import { optionsApi } from '../api';
import { corners } from '../components/frame';
import { Statue } from '../components/statue';
import { h } from '../dom';
import { t } from '../i18n';
import { hrefFor, type Route } from '../router';
import type { SetupState } from '../setup-state';
import type { PolicyOut } from '../types';
import { LayersCard } from './layers-card';
import { LockCard } from './lock-card';
import { ProtectionCard, quotaMeter } from './protection-card';

const QUOTA_REFRESH_MS = 15_000;

function stat(label: string, value: string, tone: 'green' | 'orange'): { el: HTMLElement; value: HTMLElement } {
  const valueEl = h('span', { className: 'stat-value', text: value });
  return { el: h('div', { className: `stat tone-${tone}` }, ...corners(), valueEl, h('span', { className: 'stat-label mono', text: label })), value: valueEl };
}

const REOPEN: readonly { route: Route; key: 'title.manual' | 'title.agentic' | 'title.test' | 'title.calibration' | 'title.sites' | 'title.channels' }[] = [
  { route: 'manual', key: 'title.manual' },
  { route: 'agentic', key: 'title.agentic' },
  { route: 'test', key: 'title.test' },
  { route: 'calibration', key: 'title.calibration' },
  { route: 'channels', key: 'title.channels' },
  { route: 'sites', key: 'title.sites' },
];

/** "Manual setup · Brain Smooch" -> "Manual setup". */
function shortTitle(text: string): string {
  return text.split(' · ')[0] ?? text;
}

export function renderDashboard(setup: SetupState, policy: PolicyOut | null): HTMLElement {
  const unknown = t('dashboard.unknown');
  const lists = policy?.content.channel_lists ?? {};
  const channels = (lists.NO?.length ?? 0) + (lists.LIMITADO?.length ?? 0) + (lists.LIBRE?.length ?? 0);
  const judge = stat(t('dashboard.judge'), unknown, 'green');
  const pending = stat(t('dashboard.pending'), unknown, 'orange');
  const quota = stat(t('dashboard.quota'), unknown, 'orange');
  const meter = h('div', { className: 'dashboard-quota' });
  const stats = [
    judge,
    stat(t('dashboard.sites'), policy ? String(policy.content.blocked_sites?.length ?? 0) : unknown, 'orange'),
    stat(t('dashboard.channels'), policy ? String(channels) : unknown, 'green'),
    pending,
    quota,
    stat(t('dashboard.policy'), policy ? `v${policy.version}` : unknown, 'green'),
  ];
  const refreshQuota = () =>
    void optionsApi.quotaToday().then((res) => {
      if (!res.ok) return;
      quota.value.replaceChildren(formatMinutes(res.data.remaining_s), h('small', { className: 'mono', text: ` / ${formatMinutes(res.data.daily_s)}` }));
      meter.replaceChildren(quotaMeter(res.data));
    });
  refreshQuota();
  // The quota is spent from YouTube (heartbeats every ~15 s): keep the meter live.
  const quotaTimer = window.setInterval(() => {
    if (!meter.isConnected && !quota.el.isConnected) return window.clearInterval(quotaTimer);
    if (document.visibilityState === 'visible') refreshQuota();
  }, QUOTA_REFRESH_MS);
  void optionsApi.liveSettings().then((res) => {
    if (res.ok) judge.value.replaceChildren(res.data.judge, h('small', { className: 'mono', text: ` ${t('dashboard.judgeConfig', { config: res.data.config })}` }));
  });
  void optionsApi.feedback().then((res) => {
    if (res.ok) pending.value.textContent = String(res.data.pending);
  });
  return h(
    'div',
    { className: 'dashboard' },
    h(
      'header',
      { className: 'hero hero-dashboard' },
      h('p', { className: 'eyebrow mono' }, h('span', { className: 'live-dot', attrs: { 'aria-hidden': 'true' } }), t('dashboard.eyebrow')),
      h('h1', { className: 'display', text: t('dashboard.title') }),
      h('p', { className: 'lead', text: t('dashboard.lead') }),
    ),
    h(
      'div',
      { className: 'dashboard-body' },
      h('div', { className: 'dashboard-statues' }, new Statue('craftsman', setup.light.manual, 'small').element, new Statue('robot', setup.light.agentic, 'small').element),
      h('div', { className: 'stat-grid' }, ...stats.map((s) => s.el)),
    ),
    meter,
    h('div', { className: 'tools dashboard-cards' }, new ProtectionCard().element, new LockCard().element, new LayersCard().element),
    h(
      'nav',
      { className: 'reopen', attrs: { 'aria-label': t('dashboard.reopen') } },
      h('span', { className: 'section-title mono', text: t('dashboard.reopen') }),
      ...REOPEN.map(({ route, key }) => h('a', { className: 'btn secondary', text: shortTitle(t(key)), attrs: { href: hrefFor(route) } })),
      h('a', { className: 'btn ghost', text: t('dashboard.setupScreen'), attrs: { href: hrefFor('setup') } }),
    ),
  );
}

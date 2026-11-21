// Landing: three numbered squares (01 manual / craftsman, 02 agentic / robot,
// 03 launch / rocket), the pre-launch steps (channels, extra sites), and the
// tools (Probar política, live judge, calibration). Once launched it shows the
// "System active" dashboard instead of the squares (#configurar forces them).
import { rocketSvg } from '../art/statues';
import { optionsApi } from '../api';
import { corners, panel, square } from '../components/frame';
import { playLaunch } from '../components/launch';
import { Statue } from '../components/statue';
import { errorNotice, show, spinner } from '../components/status';
import { h } from '../dom';
import { t, tn } from '../i18n';
import { hrefFor } from '../router';
import { isSetupComplete, loadSetup, updateSetup, type SetupState } from '../setup-state';
import type { PolicyOut } from '../types';
import { CalibrationCard } from './calibration';
import { renderDashboard } from './dashboard';
import { LiveJudgeCard } from './live-judge-card';

export interface LandingOptions {
  /** Scroll to the calibration card (#calibracion, linked from the label panel). */
  focusCalibration?: boolean;
  /** Show the setup squares even after launch (#configurar). */
  forceSetup?: boolean;
}

export function renderLanding(options: LandingOptions = {}): HTMLElement {
  const root = h('div', { className: 'view landing' }, spinner(t('common.loadingPolicy')));
  void Promise.all([loadSetup(), optionsApi.getPolicy()]).then(([setup, policy]) => {
    const current = policy.ok ? policy.data : null;
    const status = h('div', { className: 'service-status' });
    if (policy.ok) show(status, h('p', { className: 'muted small mono', text: t('status.connected', { version: policy.data.version, policyVersion: policy.data.policy_version }) }));
    else show(status, errorNotice(policy.error, policy.status, t('common.cannotReadPolicy')));
    const main = setup.launched && !options.forceSetup ? renderDashboard(setup, current) : setupScreen(root, setup, current, options);
    root.replaceChildren(main, toolsSection(options), status);
  });
  return root;
}

function hero(): HTMLElement {
  return h(
    'header',
    { className: 'hero' },
    h('p', { className: 'eyebrow mono', text: t('landing.eyebrow') }),
    h('h1', { className: 'display', text: t('landing.title') }),
    h('p', { className: 'lead', text: t('landing.lead') }),
  );
}

function setupScreen(root: HTMLElement, setup: SetupState, policy: PolicyOut | null, options: LandingOptions): HTMLElement {
  const complete = isSetupComplete(setup);
  const launch = async () => {
    await playLaunch();
    await updateSetup((s) => ({ ...s, launched: true }));
    if (options.forceSetup) location.hash = hrefFor('landing');
    else root.replaceWith(renderLanding());
    window.scrollTo({ top: 0 });
  };
  const rocket = rocketSvg();
  rocket.classList.toggle('lit-all', complete);
  return h(
    'div',
    { className: 'setup-screen' },
    hero(),
    h(
      'div',
      { className: 'square-grid' },
      square({
        index: '01',
        title: t('landing.manual.title'),
        text: t('landing.manual.text'),
        cta: t('landing.manual.cta'),
        art: new Statue('craftsman', setup.light.manual).element,
        tone: 'orange',
        href: hrefFor('manual'),
      }),
      square({
        index: '02',
        title: t('landing.agentic.title'),
        text: t('landing.agentic.text'),
        cta: t('landing.agentic.cta'),
        art: new Statue('robot', setup.light.agentic).element,
        tone: 'green',
        href: hrefFor('agentic'),
      }),
      square({
        index: '03',
        title: t('landing.launch.title'),
        text: t('landing.launch.text'),
        cta: t('landing.launch.cta'),
        art: h('figure', { className: 'statue-frame statue-large' }, rocket),
        tone: 'dual',
        locked: !complete,
        lockedText: t('landing.launch.locked'),
        onClick: () => void launch(),
      }),
    ),
    prelaunch(setup, policy),
    h('p', { className: 'muted small same-policy-note', text: t('landing.samePolicy') }),
  );
}

function check(done: boolean, text: string): HTMLElement {
  return h('li', { className: `check${done ? ' done' : ''}` }, h('span', { className: 'check-box', text: done ? '✓' : '', attrs: { 'aria-hidden': 'true' } }), text);
}

/** Pre-launch steps: channel lists (optional) and extra sites, plus the checklist that unlocks the rocket. */
function prelaunch(setup: SetupState, policy: PolicyOut | null): HTMLElement {
  const sites = policy?.content.blocked_sites?.length ?? 0;
  const lists = policy?.content.channel_lists ?? {};
  const channels = (lists.NO?.length ?? 0) + (lists.LIMITADO?.length ?? 0) + (lists.LIBRE?.length ?? 0);
  const step = (index: string, kicker: string, title: string, text: string, count: string, cta: string, href: string, tone: string) =>
    h(
      'a',
      { className: `step-link tone-${tone}`, attrs: { href } },
      ...corners(),
      h('span', { className: 'step-index mono', text: index, attrs: { 'aria-hidden': 'true' } }),
      h('span', { className: 'step-kicker mono', text: kicker }),
      h('strong', { className: 'step-title', text: title }),
      h('span', { className: 'step-text', text }),
      h('span', { className: 'step-count mono', text: count }),
      h('span', { className: 'square-cta', text: cta }),
    );
  return panel(
    'prelaunch',
    h(
      'div',
      { className: 'prelaunch-steps' },
      step('A', t('landing.channels.kicker'), t('landing.channels.title'), t('landing.channels.text'), tn(channels, 'landing.channels.count'), t('landing.channels.cta'), hrefFor('channels'), 'green'),
      step('B', t('landing.sites.kicker'), t('landing.sites.title'), t('landing.sites.text'), tn(sites, 'landing.sites.count'), t('landing.sites.cta'), hrefFor('sites'), 'orange'),
    ),
    h('ul', { className: 'checklist mono' }, check(setup.policySaved, t('landing.checklist.policy')), check(setup.sitesReviewed, t('landing.checklist.sites'))),
  );
}

function toolsSection(options: LandingOptions): HTMLElement {
  return h(
    'section',
    { className: 'tools' },
    h('h2', { className: 'section-title mono', text: t('landing.tools') }),
    h(
      'a',
      { className: 'tool-link', attrs: { href: hrefFor('test') } },
      ...corners(),
      h('span', { className: 'tool-icon', text: '🧪', attrs: { 'aria-hidden': 'true' } }),
      h('span', {}, h('strong', { text: t('landing.test.title') }), h('span', { className: 'muted block', text: t('landing.test.text') })),
      h('span', { className: 'square-cta', text: t('landing.test.cta') }),
    ),
    new LiveJudgeCard().element,
    new CalibrationCard(options.focusCalibration ?? false).element,
  );
}

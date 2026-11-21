// Entry point of the local web (onboarding + dashboard, served by the service
// at http://127.0.0.1:8765/): language first, then a hash-routed view under a
// fixed top bar. Changing the language re-renders the current view and is
// sent to the service so the extension's screens use it too.
import { isExtensionContext } from '../platform/storage';
import { optionsApi } from './api';
import { topBar } from './components/topbar';
import { currentLang, initLang, isLang, onLangChange, setLang, storedLang, t, type MessageKey } from './i18n';
import { lockApi } from './lock-client';
import { importSetup, SETUP_IMPORT_PARAM } from './setup-state';
import { currentRoute, onRouteChange, type Route } from './router';
import { renderChannels } from './views/channels';
import { renderCustodian } from './views/custodian';
import { renderLanding } from './views/landing';
import { renderLock } from './views/lock';
import { renderManual } from './views/manual';
import { renderRecoveryKit } from './views/recovery-kit';
import { renderSites } from './views/sites';
import { renderTestPolicy } from './views/test-policy';
import { renderWizard } from './wizard';

const VIEWS: Record<Route, () => HTMLElement> = {
  landing: () => renderLanding(),
  setup: () => renderLanding({ forceSetup: true }),
  manual: renderManual,
  agentic: renderWizard,
  test: renderTestPolicy,
  calibration: () => renderLanding({ focusCalibration: true }),
  sites: renderSites,
  channels: renderChannels,
  custodian: renderCustodian,
  lock: renderLock,
  kit: renderRecoveryKit,
};

const TITLES: Record<Route, MessageKey> = {
  landing: 'title.landing',
  setup: 'title.setup',
  manual: 'title.manual',
  agentic: 'title.agentic',
  test: 'title.test',
  calibration: 'title.calibration',
  sites: 'title.sites',
  channels: 'title.channels',
  custodian: 'title.custodian',
  lock: 'title.lock',
  kit: 'title.kit',
};

/** On the web: no stored language yet -> the one saved in the service (if any). */
async function syncLanguage(): Promise<void> {
  if (isExtensionContext()) return;
  if (!(await storedLang())) {
    const res = await optionsApi.uiSettings();
    if (res.ok && isLang(res.data.language)) setLang(res.data.language);
  }
  onLangChange((lang) => void optionsApi.saveUiLanguage(lang));
}

async function start(): Promise<void> {
  const query = new URLSearchParams(location.search);
  if (query.has(SETUP_IMPORT_PARAM)) {
    await importSetup(query.get(SETUP_IMPORT_PARAM));
    history.replaceState(null, '', `${location.pathname}${location.hash}`);
  }
  await initLang();
  await syncLanguage();
  await lockApi.status(); // recovers the CSRF token of an open admin session
  const app = document.getElementById('app');
  if (!app) return;
  const bar = document.createElement('div');
  document.body.prepend(bar);
  const render = (route: Route, scroll = true) => {
    document.documentElement.lang = currentLang();
    document.title = t(TITLES[route]);
    bar.replaceChildren(topBar());
    const view = VIEWS[route]();
    view.classList.add('view-enter');
    app.replaceChildren(view);
    if (scroll) window.scrollTo({ top: 0 });
  };
  onLangChange(() => render(currentRoute(), false));
  onRouteChange((route) => render(route));
}

void start();

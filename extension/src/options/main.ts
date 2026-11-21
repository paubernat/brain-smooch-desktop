// Entry point of the options page ("Configura tu perfil"): language first,
// then a hash-routed view under a fixed top bar. Changing the language
// re-renders the current view.
import { topBar } from './components/topbar';
import { currentLang, initLang, onLangChange, t, type MessageKey } from './i18n';
import { currentRoute, onRouteChange, type Route } from './router';
import { renderChannels } from './views/channels';
import { renderLanding } from './views/landing';
import { renderManual } from './views/manual';
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
};

async function start(): Promise<void> {
  await initLang();
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

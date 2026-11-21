// Entry point of the options page ("Configura tu perfil").
import { onRouteChange, type Route } from './router';
import { renderLanding } from './views/landing';
import { renderManual } from './views/manual';
import { renderWizard } from './wizard';

const VIEWS: Record<Route, () => HTMLElement> = {
  landing: () => renderLanding(),
  manual: renderManual,
  agentic: renderWizard,
  calibration: () => renderLanding({ focusCalibration: true }),
};

const TITLES: Record<Route, string> = {
  landing: 'Configura tu perfil',
  manual: 'Configuración manual · Brain Smooch',
  agentic: 'Configuración agéntica · Brain Smooch',
  calibration: 'Calibración · Brain Smooch',
};

const app = document.getElementById('app');
if (app) {
  onRouteChange((route) => {
    document.title = TITLES[route];
    app.replaceChildren(VIEWS[route]());
    window.scrollTo({ top: 0 });
  });
}

// Landing: welcome, the two ways of configuring the profile and the calibration card.
import { optionsApi } from '../api';
import { errorNotice, show } from '../components/status';
import { h } from '../dom';
import { hrefFor, type Route } from '../router';
import { CalibrationCard } from './calibration';

interface ModeCard {
  route: Route;
  icon: string;
  title: string;
  text: string;
  cta: string;
}

const MODES: readonly ModeCard[] = [
  {
    route: 'agentic',
    icon: '✦',
    title: 'Configuración agéntica',
    text: 'Cuéntalo con tus palabras; la IA redacta la política y la afina con los vídeos que ya has etiquetado.',
    cta: 'Empezar el asistente →',
  },
  {
    route: 'manual',
    icon: '✎',
    title: 'Configuración manual',
    text: 'Edita tú mismo las instrucciones, las tres categorías, las preguntas auxiliares y las listas de canales.',
    cta: 'Abrir el editor →',
  },
];

export interface LandingOptions {
  /** Scroll to the calibration card (#calibracion, linked from the label panel). */
  focusCalibration?: boolean;
}

export function renderLanding(options: LandingOptions = {}): HTMLElement {
  const status = h('div', { className: 'service-status' });
  void checkService(status);
  return h(
    'div',
    { className: 'view landing' },
    h(
      'header',
      { className: 'hero' },
      h('p', { className: 'eyebrow', text: 'Brain Smooch' }),
      h('h1', { text: 'Configura tu perfil' }),
      h('p', { className: 'lead', text: 'Decide qué vídeos de YouTube son LIBRE, cuáles LIMITADO (con cupo) y cuáles NO. El juez lo lee de tu política.' }),
    ),
    h(
      'div',
      { className: 'mode-grid' },
      ...MODES.map((m) =>
        h(
          'a',
          { className: `mode-card mode-${m.route}`, attrs: { href: hrefFor(m.route) } },
          h('span', { className: 'mode-icon', text: m.icon, attrs: { 'aria-hidden': 'true' } }),
          h('h2', { text: m.title }),
          h('p', { text: m.text }),
          h('span', { className: 'mode-cta', text: m.cta }),
        ),
      ),
    ),
    new CalibrationCard(options.focusCalibration ?? false).element,
    status,
  );
}

async function checkService(slot: HTMLElement): Promise<void> {
  const res = await optionsApi.getPolicy();
  if (!res.ok) {
    show(slot, errorNotice(res.error, res.status, 'No se pudo leer la política'));
    return;
  }
  show(slot, h('p', { className: 'muted small', text: `Servicio conectado · política v${res.data.version} (${res.data.policy_version})` }));
}

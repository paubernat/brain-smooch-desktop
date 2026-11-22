// "Layers" card (dashboard): the Windows enforcement layers E1-E9 with their
// status (✓ / ✗ / pending / needs admin), the latest tampering repaired by the
// integrity check and the browsers seen or closed by the browser watch.
// Refreshes every 30 s while it is on screen.
import type { EnforceEvent, EnforceEventKind, LayerId, LayerReport, LayerStatus, SystemStatus } from '../types';
import { optionsApi } from '../api';
import { corners } from '../components/frame';
import { errorNotice, formatWhen, notice, show, spinner } from '../components/status';
import { h } from '../dom';
import { t, type MessageKey } from '../i18n';

const REFRESH_MS = 30_000;
const TAMPER_KINDS: EnforceEventKind[] = ['tamper', 'error', 'removed'];
const BROWSER_KINDS: EnforceEventKind[] = ['browser_closed', 'browser_seen'];

export const STATUS_MARK: Readonly<Record<LayerStatus, string>> = {
  ok: '✓',
  missing: '✗',
  pending: '…',
  requires_admin: '⚑',
};

const LAYER_NAME: Readonly<Record<LayerId, MessageKey>> = {
  E1: 'layers.name.E1',
  E2: 'layers.name.E2',
  E3: 'layers.name.E3',
  E4: 'layers.name.E4',
  E5: 'layers.name.E5',
  E6: 'layers.name.E6',
  E7: 'layers.name.E7',
  E8: 'layers.name.E8',
  E9: 'layers.name.E9',
};

const STATUS_TEXT: Readonly<Record<LayerStatus, MessageKey>> = {
  ok: 'layers.status.ok',
  missing: 'layers.status.missing',
  pending: 'layers.status.pending',
  requires_admin: 'layers.status.requires_admin',
};

const EVENT_TEXT: Readonly<Record<EnforceEventKind, MessageKey>> = {
  tamper: 'layers.event.tamper',
  applied: 'layers.event.applied',
  removed: 'layers.event.removed',
  browser_seen: 'layers.event.browser_seen',
  browser_closed: 'layers.event.browser_closed',
  error: 'layers.event.error',
};

function layerRow(layer: LayerReport): HTMLElement {
  return h(
    'li',
    { className: `layer-row status-${layer.status}` },
    h('span', { className: 'layer-mark', text: STATUS_MARK[layer.status], attrs: { 'aria-hidden': 'true' } }),
    h('span', { className: 'layer-id mono', text: layer.id }),
    h('span', { className: 'layer-name', text: t(LAYER_NAME[layer.id]) }),
    h('span', { className: 'layer-status mono small', text: t(STATUS_TEXT[layer.status]) }),
    layer.detail ? h('span', { className: 'layer-detail muted small', text: layer.detail }) : '',
  );
}

function eventList(title: string, empty: string, events: EnforceEvent[] | null): HTMLElement {
  const items = (events ?? []).map((event) =>
    h(
      'li',
      { className: `layer-event kind-${event.kind}` },
      h('span', { className: 'mono small muted', text: formatWhen(event.at) }),
      h('strong', { text: `${t(EVENT_TEXT[event.kind])}${event.layer ? ` · ${event.layer}` : ''}` }),
      h('span', { className: 'small', text: event.detail }),
    ),
  );
  return h(
    'div',
    { className: 'layer-events' },
    h('h3', { className: 'section-title mono', text: title }),
    items.length ? h('ul', {}, ...items) : h('p', { className: 'muted small', text: events === null ? t('dashboard.unknown') : empty }),
  );
}

export class LayersCard {
  readonly element = h('section', { className: 'calibration-card layers-card', attrs: { id: 'capas', 'aria-labelledby': 'layers-title' } });
  private readonly body = h('div', {}, spinner(t('layers.loading')));
  private timer: number | undefined;

  constructor() {
    this.element.append(
      ...corners(),
      h('header', {}, h('span', { className: 'mode-icon', text: '🧱', attrs: { 'aria-hidden': 'true' } }), h('h2', { text: t('layers.title'), attrs: { id: 'layers-title' } })),
      h('p', { className: 'muted', text: t('layers.lead') }),
      this.body,
    );
    void this.load();
    this.timer = window.setInterval(() => {
      if (!this.element.isConnected) return window.clearInterval(this.timer);
      if (document.visibilityState === 'visible') void this.load();
    }, REFRESH_MS);
  }

  private async load(): Promise<void> {
    const [status, tamper, browsers] = await Promise.all([
      optionsApi.systemLayers(),
      optionsApi.systemEvents(TAMPER_KINDS),
      optionsApi.systemEvents(BROWSER_KINDS),
    ]);
    if (!status.ok) return show(this.body, errorNotice(status.error, status.status, t('layers.cannotRead')));
    this.render(status.data, tamper.ok ? tamper.data : null, browsers.ok ? browsers.data : null);
  }

  private render(status: SystemStatus, tamper: EnforceEvent[] | null, browsers: EnforceEvent[] | null): void {
    const banner = status.suspended
      ? notice('warn', t('layers.suspended'))
      : !status.production
        ? notice('info', h('p', { text: t('layers.notInstalled') }), h('code', { className: 'command', text: 'installer\\install.ps1 -DryRun' }))
        : null;
    show(
      this.body,
      banner,
      h('ul', { className: 'layer-list' }, ...status.layers.map(layerRow)),
      h('p', { className: 'muted small', text: t('layers.legend') }),
      h('div', { className: 'layer-event-grid' }, eventList(t('layers.tamperTitle'), t('layers.noTamper'), tamper), eventList(t('layers.browsersTitle'), t('layers.noBrowsers'), browsers)),
    );
  }
}

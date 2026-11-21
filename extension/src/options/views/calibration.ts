// "Calibración" card on the landing: labels not yet incorporated into the
// policy and a button that asks Claude for a revised policy from them. The
// proposal is shown as a diff + changelog; accepting saves it (new version)
// and marks those labels as incorporated. Only the dev split is used.
import { optionsApi } from '../api';
import { policyDiffView } from '../components/policy-diff-view';
import { rationaleBox } from '../components/rationale';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { plural, usd } from '../format';
import type { FeedbackItem, FeedbackSummary, Label } from '../../types';
import type { PolicyOut, RefreshResult } from '../types';

const MAX_LISTED = 50;
const TIER_ORDER: readonly Label[] = ['LIBRE', 'LIMITADO', 'NO'];
const DEV_ONLY = 'Solo cuentan las etiquetas del split dev; las del split test quedan para la ablación final.';

function pill(label: Label, text: string = label): HTMLElement {
  return h('span', { className: `pill tier-${label}`, text });
}

function pendingList(items: FeedbackItem[]): HTMLElement | null {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_LISTED);
  return h(
    'details',
    { className: 'pending-list' },
    h('summary', { text: 'Ver etiquetas pendientes' }),
    h(
      'ul',
      {},
      ...shown.map((item) =>
        h(
          'li',
          {},
          pill(item.label),
          ' ',
          h('a', { text: item.title || item.video_id, attrs: { href: `https://www.youtube.com/watch?v=${item.video_id}`, target: '_blank', rel: 'noopener noreferrer' } }),
          item.is_short ? h('span', { className: 'muted small', text: ' · Short' }) : null,
          item.reason ? h('span', { className: 'reason block', text: `«${item.reason}»` }) : null,
        ),
      ),
    ),
    items.length > shown.length ? h('p', { className: 'muted small', text: `… y ${items.length - shown.length} más.` }) : null,
  );
}

export class CalibrationCard {
  readonly element = h('section', { className: 'calibration-card', attrs: { id: 'calibracion', 'aria-labelledby': 'calibration-title' } });
  private readonly summarySlot = h('div');
  private readonly proposalSlot = h('div');

  constructor(private focus = false) {
    this.element.append(
      h('header', {}, h('span', { className: 'mode-icon', text: '⟳', attrs: { 'aria-hidden': 'true' } }), h('h2', { text: 'Calibración', attrs: { id: 'calibration-title' } })),
      h('p', { className: 'muted', text: 'Las etiquetas que pones en YouTube (y sus motivos) se acumulan aquí hasta que las incorporas a la política.' }),
      this.summarySlot,
      this.proposalSlot,
    );
    void this.load();
  }

  private async load(): Promise<void> {
    show(this.summarySlot, spinner('Contando etiquetas pendientes…'));
    const res = await optionsApi.feedback();
    if (!res.ok) {
      show(this.summarySlot, errorNotice(res.error, res.status, 'No se pudieron leer las etiquetas pendientes'));
      return;
    }
    this.renderSummary(res.data);
    if (this.focus) this.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.focus = false;
  }

  private renderSummary(f: FeedbackSummary): void {
    const refresh = button('Refrescar política', () => void withBusy(refresh, 'Claude está revisando…', () => this.refresh()), 'primary');
    refresh.disabled = f.pending === 0;
    const breakdown = TIER_ORDER.filter((l) => f.by_label[l] > 0).map((l) => pill(l, `${l} ${f.by_label[l]}`));
    show(
      this.summarySlot,
      h(
        'div',
        { className: 'calibration-summary' },
        h(
          'div',
          {},
          h('p', { className: 'pending-count' }, h('strong', { text: plural(f.pending, 'etiqueta pendiente', 'etiquetas pendientes') })),
          breakdown.length ? h('p', { className: 'pills' }, ...breakdown) : null,
          h('p', {
            className: 'muted small',
            text: `${plural(f.with_reason, 'con motivo', 'con motivo')} · ${plural(f.pending_test, 'pendiente', 'pendientes')} en test (no se usan). ${DEV_ONLY}`,
          }),
        ),
        refresh,
      ),
      f.pending >= f.hint_threshold ? notice('warn', `Ya tienes ${f.pending} etiquetas sin incorporar: conviene refrescar la política.`) : null,
      pendingList(f.items),
    );
  }

  private async refresh(): Promise<void> {
    show(this.proposalSlot, spinner('Claude está leyendo tus etiquetas y motivos y revisando la política…'));
    const [current, proposal] = await Promise.all([optionsApi.getPolicy(), optionsApi.refresh()]);
    if (!proposal.ok) {
      show(this.proposalSlot, errorNotice(proposal.error, proposal.status, 'No se pudo refrescar la política'));
      return;
    }
    if (!current.ok) {
      show(this.proposalSlot, errorNotice(current.error, current.status, 'No se pudo leer la política'));
      return;
    }
    this.renderProposal(current.data, proposal.data);
    this.proposalSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private renderProposal(current: PolicyOut, p: RefreshResult): void {
    const status = h('div', { className: 'status-slot' });
    const accept = button('Aceptar y guardar', () => void withBusy(accept, 'Guardando…', () => this.accept(p, status)), 'primary');
    const discard = button('Descartar', () => show(this.proposalSlot), 'ghost');
    const cost = p.usage.cost_usd !== null ? ` · coste ≈ ${usd(p.usage.cost_usd)}` : '';
    show(
      this.proposalSlot,
      h(
        'section',
        { className: 'proposal' },
        rationaleBox(p.rationale, p.changelog, 'Propuesta de política'),
        h('p', { className: 'muted small', text: `Basada en ${plural(p.feedback.length, 'etiqueta dev', 'etiquetas dev')} · sobre la versión ${p.base_version}${cost}` }),
        policyDiffView(current.content, p.content),
        h('div', { className: 'actions' }, status, discard, accept),
      ),
    );
  }

  private async accept(p: RefreshResult, status: HTMLElement): Promise<void> {
    const res = await optionsApi.savePolicy({ content: p.content }, p.base_version, p.feedback);
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, 'No se pudo guardar'));
      return;
    }
    const incorporated = res.data.incorporated ?? 0;
    show(
      this.proposalSlot,
      notice(
        'ok',
        h('strong', { text: `Política guardada como versión ${res.data.version}.` }),
        h('p', { text: `${plural(incorporated, 'etiqueta incorporada', 'etiquetas incorporadas')}. La versión anterior queda en policy/history/.` }),
      ),
    );
    await this.load();
  }
}

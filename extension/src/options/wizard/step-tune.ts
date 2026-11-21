// Step 3: evaluate the draft on the dev split, then improve it with Claude.
import { optionsApi } from '../api';
import { PolicyEditor } from '../components/policy-editor';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, field, h, withBusy } from '../dom';
import { pricePerMtok } from '../format';
import type { JudgesOut, LabelStats } from '../types';
import type { WizardContext } from './context';
import { MIN_DEV_LABELS, acceptProposal, pickDefaultJudge, refineRequest, withDraft } from './state';
import { errorsTable, estimateLine, metricsRow, proposalPanel } from './tune-results';

const EDIT_DEBOUNCE_MS = 700;
const DEV_ONLY =
  'Solo se usan tus vídeos etiquetados del split dev. El split test queda reservado para la ablación final y aquí nunca se mira.';

export function renderTune(ctx: WizardContext): HTMLElement {
  if (!ctx.state.draft) return h('div', {}, notice('warn', 'Aún no hay borrador.'), button('← Describe', () => ctx.goto('describe')));
  const body = h('div', {}, spinner('Cargando jueces y etiquetas…'));
  const root = h('div', { className: 'step tune' }, notice('info', DEV_ONLY), body, footer(ctx));
  void ctx.catalog().then((catalog) => {
    if ('error' in catalog) show(body, errorNotice(catalog.error, catalog.status, 'No se pudo cargar la lista de jueces'));
    else if (catalog.stats.by_split.dev < MIN_DEV_LABELS) show(body, fewLabels(ctx, catalog.stats));
    else show(body, new TunePanel(ctx, catalog.judges).element);
  });
  return root;
}

function footer(ctx: WizardContext): HTMLElement {
  return h(
    'div',
    { className: 'actions sticky' },
    button('← Borrador', () => ctx.goto('draft'), 'ghost'),
    button('Guardar →', () => ctx.goto('save'), 'primary'),
  );
}

function fewLabels(ctx: WizardContext, stats: LabelStats): HTMLElement {
  return notice(
    'warn',
    h('strong', { text: `Tienes ${stats.by_split.dev} vídeos etiquetados en dev; hacen falta al menos ${MIN_DEV_LABELS}.` }),
    h('p', { text: 'Etiqueta más vídeos con el panel de YouTube (Alt+1/2/3) y vuelve a este paso. Mientras tanto puedes guardar el borrador tal cual.' }),
    button('Saltar y guardar →', () => ctx.goto('save')),
  );
}

class TunePanel {
  readonly element: HTMLElement;
  private readonly estimateSlot = h('div', { className: 'status-slot' });
  private readonly resultsSlot = h('div');
  private readonly proposalSlot = h('div');
  private readonly editor: PolicyEditor;
  private editTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ctx: WizardContext, judges: JudgesOut) {
    const state = ctx.state;
    if (!state.judge) ctx.update({ ...state, judge: pickDefaultJudge(judges), config: state.config || judges.default_config });
    this.editor = new PolicyEditor(ctx.state.draft!, {
      showChannels: false,
      onChange: (policy) => {
        ctx.update(withDraft(ctx.state, policy));
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(() => this.renderAll(), EDIT_DEBOUNCE_MS);
      },
    });
    this.element = h(
      'div',
      {},
      this.controls(judges),
      this.estimateSlot,
      this.resultsSlot,
      this.proposalSlot,
      h('details', { className: 'draft-details' }, h('summary', { text: 'Ver o editar el borrador' }), this.editor.element),
    );
    this.renderAll();
  }

  private controls(judges: JudgesOut): HTMLElement {
    const judgeSelect = h('select');
    for (const j of judges.judges) {
      const label = j.key_configured ? `${j.key} · ${pricePerMtok(j.input_per_mtok)}` : `${j.key} · falta ${j.key_env}`;
      const opt = h('option', { text: label, attrs: { value: j.key } });
      opt.disabled = !j.key_configured;
      judgeSelect.append(opt);
    }
    judgeSelect.value = this.ctx.state.judge ?? '';
    judgeSelect.addEventListener('change', () => {
      this.ctx.update({ ...this.ctx.state, judge: judgeSelect.value, estimate: null, evaluation: null, proposal: null });
      this.renderAll();
    });
    const configSelect = h('select');
    for (const c of judges.configs) configSelect.append(h('option', { text: `${c.id} · ${c.levels}`, attrs: { value: c.id } }));
    configSelect.value = this.ctx.state.config;
    configSelect.addEventListener('change', () => {
      this.ctx.update({ ...this.ctx.state, config: configSelect.value, estimate: null, evaluation: null, proposal: null });
      this.renderAll();
    });
    return h('div', { className: 'controls' }, field('Juez', judgeSelect), field('Niveles de información', configSelect, 'D = metadatos + canal + transcripción'));
  }

  private renderAll(): void {
    const s = this.ctx.state;
    if (!s.judge) {
      show(this.estimateSlot, notice('warn', 'Ningún juez tiene clave de API configurada. Añade una en el .env de la raíz (p. ej. LIQUID_API_KEY) y reinicia el servicio.'));
      return;
    }
    if (s.estimate) this.showEstimate();
    else void this.loadEstimate();
    if (s.evaluation) {
      show(this.resultsSlot, h('h3', { text: 'Resultados en dev' }), metricsRow(s.evaluation), this.improveButton(), errorsTable(s.evaluation.errors));
    } else {
      show(this.resultsSlot);
    }
    if (s.proposal) {
      show(this.proposalSlot, proposalPanel(s.proposal, () => this.accept(), () => this.reject()));
    } else {
      show(this.proposalSlot);
    }
  }

  private async loadEstimate(): Promise<void> {
    show(this.estimateSlot, spinner('Calculando llamadas y coste…'));
    const s = this.ctx.state;
    const res = await optionsApi.evaluate({ content: s.draft!, judge: s.judge!, config: s.config, dry_run: true });
    if (this.stale(s)) return;
    if (!res.ok) {
      show(this.estimateSlot, errorNotice(res.error, res.status, 'No se pudo estimar el coste'));
      return;
    }
    this.ctx.update({ ...this.ctx.state, estimate: res.data });
    this.showEstimate();
  }

  private showEstimate(): void {
    const e = this.ctx.state.estimate!;
    const run = button(e.calls ? 'Evaluar' : 'Ver resultados', () => void withBusy(run, 'Evaluando…', () => this.evaluate()), 'primary');
    show(this.estimateSlot, h('div', { className: 'estimate-row' }, estimateLine(e), run));
  }

  private async evaluate(): Promise<void> {
    show(this.resultsSlot, spinner('Evaluando el borrador en dev… puede tardar un poco si hay muchas llamadas nuevas.'));
    const s = this.ctx.state;
    const res = await optionsApi.evaluate({ content: s.draft!, judge: s.judge!, config: s.config, dry_run: false });
    if (this.stale(s)) return;
    if (!res.ok) {
      show(this.resultsSlot, errorNotice(res.error, res.status, 'La evaluación ha fallado'));
      return;
    }
    const failures = res.data.failures ? notice('warn', `${res.data.failures} llamadas fallaron y no cuentan en las métricas.`) : null;
    this.ctx.update({ ...this.ctx.state, evaluation: res.data, estimate: { ...res.data, calls: 0, cached: res.data.n_dev } });
    this.renderAll();
    if (failures) this.resultsSlot.prepend(failures);
  }

  private improveButton(): HTMLElement | null {
    const req = refineRequest(this.ctx.state);
    if (!req) return null;
    const b = button('Mejorar con IA', () => void withBusy(b, 'Claude está revisando los errores…', async () => {
      show(this.proposalSlot, spinner('Claude está revisando los errores y reescribiendo la política…'));
      const before = this.ctx.state;
      const res = await optionsApi.refine(req);
      if (this.stale(before)) return;
      if (!res.ok) {
        show(this.proposalSlot, errorNotice(res.error, res.status, 'No se pudo mejorar el borrador'));
        return;
      }
      this.ctx.update({ ...this.ctx.state, proposal: res.data });
      this.renderAll();
      this.proposalSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }), 'primary');
    return h('div', { className: 'actions inline' }, h('span', { className: 'muted small', text: 'Envía el borrador y los errores (resumidos) a Claude para que proponga una versión mejor.' }), b);
  }

  /** The draft, judge or config changed while a request was in flight. */
  private stale(before: WizardContext['state']): boolean {
    const now = this.ctx.state;
    return now.draft !== before.draft || now.judge !== before.judge || now.config !== before.config;
  }

  private accept(): void {
    this.ctx.update(acceptProposal(this.ctx.state));
    this.editor.setPolicy(this.ctx.state.draft!);
    this.renderAll();
  }

  private reject(): void {
    this.ctx.update({ ...this.ctx.state, proposal: null });
    this.renderAll();
  }
}

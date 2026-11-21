// "Probar política": evaluate a policy on the dev split with a judge, see the
// errors and ask Claude for an improved version. Used by the wizard (step 3),
// the manual editor and the standalone #probar view.
import { optionsApi } from '../api';
import { button, field, h, withBusy } from '../dom';
import { pricePerMtok } from '../format';
import { t } from '../i18n';
import { MIN_DEV_LABELS, acceptProposal, pickDefaultJudge, refineRequest, withDraft, type TuneState } from '../tune-state';
import type { JudgesOut, LabelStats, PolicyContent } from '../types';
import { PolicyEditor } from './policy-editor';
import { errorNotice, notice, show, spinner } from './status';
import { errorsTable, estimateLine, metricsRow, proposalPanel } from './tune-results';

const EDIT_DEBOUNCE_MS = 700;
export function devOnlyNote(): string {
  return t('tester.devOnly');
}

/** Where the tester keeps its state (the wizard persists it; other views keep it in memory). */
export interface TuneSession<S extends TuneState> {
  readonly state: S;
  update(next: S): void;
}

/** In-memory session (only the wizard persists its tuning state). */
export function memorySession<S extends TuneState>(initial: S): TuneSession<S> {
  let state = initial;
  return {
    get state() {
      return state;
    },
    update(next) {
      state = next;
    },
  };
}

export interface TesterOptions {
  /** Show the policy form inside the tester (off when the page already has one). */
  showEditor: boolean;
  /** Called with the new policy when a Claude proposal is accepted. */
  onAccept?: (policy: PolicyContent) => void;
}

export type TuneCatalog = { judges: JudgesOut; stats: LabelStats } | { error: string; status: number | null };

export async function loadTuneCatalog(): Promise<TuneCatalog> {
  const [judges, stats] = await Promise.all([optionsApi.judges(), optionsApi.labelStats()]);
  if (!judges.ok) return { error: judges.error, status: judges.status };
  if (!stats.ok) return { error: stats.error, status: stats.status };
  return { judges: judges.data, stats: stats.data };
}

export function fewLabelsNotice(stats: LabelStats, ...extra: HTMLElement[]): HTMLElement {
  return notice(
    'warn',
    h('strong', { text: t('tester.fewLabels', { dev: stats.by_split.dev, min: MIN_DEV_LABELS }) }),
    h('p', { text: t('tester.labelMore') }),
    ...extra,
  );
}

/** Loads the catalog into `slot`, then the tester (or the "few labels" notice). */
export function mountTester<S extends TuneState>(
  slot: HTMLElement,
  session: TuneSession<S>,
  options: TesterOptions,
  catalog: Promise<TuneCatalog> = loadTuneCatalog(),
  fewLabelsExtra: HTMLElement[] = [],
): Promise<PolicyTester<S> | null> {
  show(slot, spinner(t('tester.loadingCatalog')));
  return catalog.then((c) => {
    if ('error' in c) {
      show(slot, errorNotice(c.error, c.status, t('tester.cannotLoadJudges')));
      return null;
    }
    if (c.stats.by_split.dev < MIN_DEV_LABELS) {
      show(slot, fewLabelsNotice(c.stats, ...fewLabelsExtra));
      return null;
    }
    const tester = new PolicyTester(session, c.judges, options);
    show(slot, tester.element);
    return tester;
  });
}

export class PolicyTester<S extends TuneState> {
  readonly element: HTMLElement;
  private readonly estimateSlot = h('div', { className: 'status-slot' });
  private readonly resultsSlot = h('div');
  private readonly proposalSlot = h('div');
  private readonly editor: PolicyEditor | null;
  private editTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly session: TuneSession<S>, judges: JudgesOut, private readonly options: TesterOptions) {
    const state = session.state;
    if (!state.judge) session.update({ ...state, judge: pickDefaultJudge(judges), config: state.config || judges.default_config });
    this.editor = options.showEditor && session.state.draft
      ? new PolicyEditor(session.state.draft, { showChannels: false, onChange: (policy) => this.setDraft(policy) })
      : null;
    this.element = h(
      'div',
      { className: 'policy-tester' },
      this.controls(judges),
      this.estimateSlot,
      this.resultsSlot,
      this.proposalSlot,
      this.editor ? h('details', { className: 'draft-details' }, h('summary', { text: t('tester.viewEdit') }), this.editor.element) : null,
    );
    this.renderAll();
  }

  /** The policy under test changed (form edits): results are stale, re-estimate soon. */
  setDraft(policy: PolicyContent): void {
    this.session.update(withDraft(this.session.state, policy));
    clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => this.renderAll(), EDIT_DEBOUNCE_MS);
  }

  private controls(judges: JudgesOut): HTMLElement {
    const judgeSelect = judgeSelectFor(judges, this.session.state.judge ?? '');
    judgeSelect.addEventListener('change', () => {
      this.session.update({ ...this.session.state, judge: judgeSelect.value, estimate: null, evaluation: null, proposal: null });
      this.renderAll();
    });
    const configSelect = configSelectFor(judges, this.session.state.config);
    configSelect.addEventListener('change', () => {
      this.session.update({ ...this.session.state, config: configSelect.value, estimate: null, evaluation: null, proposal: null });
      this.renderAll();
    });
    return h('div', { className: 'controls' }, field(t('common.judge'), judgeSelect), field(t('common.levels'), configSelect, t('tester.levelsHint')));
  }

  private renderAll(): void {
    const s = this.session.state;
    if (!s.judge) {
      show(this.estimateSlot, notice('warn', t('tester.noJudge')));
      return;
    }
    if (s.estimate) this.showEstimate();
    else void this.loadEstimate();
    if (s.evaluation) {
      show(this.resultsSlot, h('h3', { text: t('tester.results') }), metricsRow(s.evaluation), this.improveButton(), errorsTable(s.evaluation.errors));
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
    show(this.estimateSlot, spinner(t('tester.estimating')));
    const s = this.session.state;
    const res = await optionsApi.evaluate({ content: s.draft!, judge: s.judge!, config: s.config, dry_run: true });
    if (this.stale(s)) return;
    if (!res.ok) {
      show(this.estimateSlot, errorNotice(res.error, res.status, t('tester.cannotEstimate')));
      return;
    }
    this.session.update({ ...this.session.state, estimate: res.data });
    this.showEstimate();
  }

  private showEstimate(): void {
    const e = this.session.state.estimate!;
    const run = button(e.calls ? t('tester.evaluate') : t('tester.showResults'), () => void withBusy(run, t('tester.evaluating'), () => this.evaluate()), 'primary');
    show(this.estimateSlot, h('div', { className: 'estimate-row' }, estimateLine(e), run));
  }

  private async evaluate(): Promise<void> {
    show(this.resultsSlot, spinner(t('tester.evaluatingLong')));
    const s = this.session.state;
    const res = await optionsApi.evaluate({ content: s.draft!, judge: s.judge!, config: s.config, dry_run: false });
    if (this.stale(s)) return;
    if (!res.ok) {
      show(this.resultsSlot, errorNotice(res.error, res.status, t('tester.evalFailed')));
      return;
    }
    const failures = res.data.failures ? notice('warn', t('tester.failures', { n: res.data.failures })) : null;
    this.session.update({ ...this.session.state, evaluation: res.data, estimate: { ...res.data, calls: 0, cached: res.data.n_dev } });
    this.renderAll();
    if (failures) this.resultsSlot.prepend(failures);
  }

  private improveButton(): HTMLElement | null {
    const req = refineRequest(this.session.state);
    if (!req) return null;
    const b = button(t('tester.improve'), () => void withBusy(b, t('tester.improving'), async () => {
      show(this.proposalSlot, spinner(t('tester.improvingLong')));
      const before = this.session.state;
      const res = await optionsApi.refine(req);
      if (this.stale(before)) return;
      if (!res.ok) {
        show(this.proposalSlot, errorNotice(res.error, res.status, t('tester.cannotImprove')));
        return;
      }
      this.session.update({ ...this.session.state, proposal: res.data });
      this.renderAll();
      this.proposalSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }), 'primary');
    return h('div', { className: 'actions inline' }, h('span', { className: 'muted small', text: t('tester.improveHint') }), b);
  }

  /** The draft, judge or config changed while a request was in flight. */
  private stale(before: S): boolean {
    const now = this.session.state;
    return now.draft !== before.draft || now.judge !== before.judge || now.config !== before.config;
  }

  private accept(): void {
    this.session.update(acceptProposal(this.session.state));
    const draft = this.session.state.draft!;
    this.editor?.setPolicy(draft);
    this.options.onAccept?.(draft);
    this.renderAll();
  }

  private reject(): void {
    this.session.update({ ...this.session.state, proposal: null });
    this.renderAll();
  }
}

/** Judge dropdown: price per Mtok, disabled when the API key is missing. */
export function judgeSelectFor(judges: JudgesOut, selected: string): HTMLSelectElement {
  const select = h('select');
  for (const j of judges.judges) {
    const label = j.key_configured ? `${j.key} · ${pricePerMtok(j.input_per_mtok)}` : t('tester.missingKey', { judge: j.key, env: j.key_env });
    const opt = h('option', { text: label, attrs: { value: j.key } });
    opt.disabled = !j.key_configured;
    select.append(opt);
  }
  select.value = selected;
  return select;
}

/** Config dropdown A–F; `describe` adds a one-line description per config. */
export function configSelectFor(judges: JudgesOut, selected: string, describe?: (id: string, levels: string) => string): HTMLSelectElement {
  const select = h('select');
  for (const c of judges.configs) {
    const text = describe ? describe(c.id, c.levels) : `${c.id} · ${c.levels}`;
    select.append(h('option', { text, attrs: { value: c.id } }));
  }
  select.value = selected;
  return select;
}

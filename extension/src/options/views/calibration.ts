// "Calibración" card on the landing: labels not yet incorporated into the
// policy and a button that asks Claude for a revised policy from them (with
// optional free-text instructions for the AI). "✨ Modificar con IA" applies a
// single instruction to the saved policy; with a proposal open, the same box sits
// under its diff and corrects the proposal (what the user rejects goes back to
// the saved wording). Either way
// the result is shown as a diff + changelog; accepting saves it (new version,
// through the lock: relaxing needs the admin session), marks the labels used
// as incorporated and sends a pulse through the statues. Labels from both splits are used.
import { optionsApi } from '../api';
import { AiEditBox, type AiEditChange } from '../components/ai-edit';
import { corners } from '../components/frame';
import { policyDiffView } from '../components/policy-diff-view';
import { rationaleBox } from '../components/rationale';
import { pulseStatues } from '../components/statue';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, field, h, withBusy } from '../dom';
import { usd } from '../format';
import { t, tn } from '../i18n';
import { lockApi } from '../lock-client';
import { markPolicySaved } from '../setup-state';
import type { FeedbackItem, FeedbackSummary, Label } from '../../types';
import type { FeedbackRef, PolicyContent, PolicyOut, RefreshResult } from '../types';

const MAX_LISTED = 50;
const MAX_INSTRUCTION_CHARS = 2000;
const TIER_ORDER: readonly Label[] = ['LIBRE', 'LIMITADO', 'NO'];

/** The proposal under review: a refresh from the labels and/or AI edits on top. */
interface Proposal {
  content: PolicyContent;
  baseVersion: number;
  rationale: string;
  changelog: string[];
  /** One entry per AI edit still applied (undo pops the last one). */
  aiChanges: string[];
  feedback: FeedbackRef[];
  costUsd: number | null;
  instruction: string;
}

function pill(label: Label, text: string = label): HTMLElement {
  return h('span', { className: `pill tier-${label}`, text });
}

function pendingList(items: FeedbackItem[]): HTMLElement | null {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_LISTED);
  return h(
    'details',
    { className: 'pending-list' },
    h('summary', { text: t('calibration.list') }),
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
          item.is_short ? h('span', { className: 'muted small', text: t('common.short') }) : null,
          item.reason ? h('span', { className: 'reason block', text: `«${item.reason}»` }) : null,
        ),
      ),
    ),
    items.length > shown.length ? h('p', { className: 'muted small', text: t('calibration.more', { n: items.length - shown.length }) }) : null,
  );
}

/** The usual "needs the custodian's password" notice, but opening the lock in a new tab so the proposal survives. */
function saveError(error: string, status: number | null): HTMLElement {
  const box = errorNotice(error, status, t('common.cannotSave'));
  if (status !== 401 && status !== 403) return box;
  const link = box.querySelector('a');
  link?.setAttribute('target', '_blank');
  link?.setAttribute('rel', 'noopener');
  box.append(h('p', { className: 'muted small', text: t('calibration.unlockHint') }));
  return box;
}

export class CalibrationCard {
  readonly element = h('section', { className: 'calibration-card', attrs: { id: 'calibracion', 'aria-labelledby': 'calibration-title' } });
  private readonly summarySlot = h('div');
  private readonly proposalSlot = h('div');
  private readonly instruction = h('textarea', {
    attrs: { rows: '2', maxlength: String(MAX_INSTRUCTION_CHARS), placeholder: t('calibration.instructionPlaceholder'), spellcheck: 'true' },
  });
  private readonly aiEdit: AiEditBox;
  /** Saved policy (base of the diff and of AI edits when no proposal is open). */
  private current: PolicyOut | null = null;
  private proposal: Proposal | null = null;

  constructor(private focus = false) {
    this.aiEdit = new AiEditBox(
      {
        getPolicy: () => this.editable(),
        setPolicy: (policy, change) => this.applyAiEdit(policy, change),
        getReference: () => (this.proposal ? this.current?.content : undefined),
      },
      { trigger: t('calibration.aiEdit'), triggerTitle: t('calibration.aiEditTitle') },
    );
    this.aiEdit.trigger.disabled = true; // until the saved policy is loaded
    this.syncAiEdit();
    this.element.append(
      ...corners(),
      h('header', {}, h('span', { className: 'mode-icon', text: '⟳', attrs: { 'aria-hidden': 'true' } }), h('h2', { text: t('calibration.title'), attrs: { id: 'calibration-title' } })),
      h('p', { className: 'muted', text: t('calibration.lead') }),
      this.summarySlot,
      this.aiEdit.element,
      this.proposalSlot,
    );
    void this.load();
  }

  private async load(): Promise<void> {
    show(this.summarySlot, spinner(t('calibration.counting')), this.actions());
    const [res, policy] = await Promise.all([optionsApi.feedback(), optionsApi.getPolicy()]);
    if (policy.ok) this.current = policy.data;
    this.aiEdit.trigger.disabled = this.current === null;
    if (!res.ok) {
      show(this.summarySlot, errorNotice(res.error, res.status, t('calibration.cannotRead')), this.actions());
      return;
    }
    this.renderSummary(res.data);
    if (this.focus) this.element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.focus = false;
  }

  private renderSummary(f: FeedbackSummary): void {
    const refresh = button(t('calibration.refresh'), () => void withBusy(refresh, t('calibration.refreshing'), () => this.refresh()), 'primary');
    refresh.disabled = f.pending === 0;
    const breakdown = TIER_ORDER.filter((l) => f.by_label[l] > 0).map((l) => pill(l, `${l} ${f.by_label[l]}`));
    const summary = t('calibration.withReason', { n: f.with_reason });
    show(
      this.summarySlot,
      h(
        'div',
        { className: 'calibration-summary' },
        h(
          'div',
          {},
          h('p', { className: 'pending-count' }, h('strong', { text: tn(f.pending, 'calibration.pending') })),
          breakdown.length ? h('p', { className: 'pills' }, ...breakdown) : null,
          h('p', { className: 'muted small', text: summary }),
        ),
        this.actions(refresh),
      ),
      f.pending > 0 ? h('div', { className: 'calibration-instruction' }, field(t('calibration.instruction'), this.instruction, t('calibration.instructionHint'))) : null,
      f.pending >= f.hint_threshold ? notice('warn', t('calibration.hint', { n: f.pending })) : null,
      pendingList(f.items),
    );
  }

  /** The ✨ trigger (edit the saved policy) is shown at any pending count; it hides while a proposal is open. */
  private actions(refresh?: HTMLButtonElement): HTMLElement {
    return h('div', { className: 'calibration-actions' }, this.aiEdit.trigger, refresh ?? null);
  }

  /** What the ✨ box edits: the open proposal, else the saved policy. */
  private editable(): PolicyContent {
    const content = this.proposal?.content ?? this.current?.content;
    if (!content) throw new Error('policy not loaded');
    return content;
  }

  /**
   * One ✨ box (so its undo history survives): with a proposal open it sits inline under the
   * diff, always expanded, and corrects the proposal; otherwise it hangs from the top trigger
   * and edits the saved policy.
   */
  private syncAiEdit(): void {
    const open = this.proposal !== null;
    this.aiEdit.trigger.classList.toggle('hidden', open);
    this.aiEdit.setInline(open, open ? t('calibration.proposalEditPlaceholder') : undefined);
    this.aiEdit.setHelp(open ? t('calibration.proposalEditHelp') : t('calibration.aiEditHelp', { target: t('calibration.aiTargetSaved') }));
    if (!open && this.aiEdit.element.parentElement !== this.element) this.proposalSlot.before(this.aiEdit.element);
  }

  private applyAiEdit(policy: PolicyContent, change: AiEditChange): void {
    if (!this.current) return;
    const p: Proposal = this.proposal ?? {
      content: policy,
      baseVersion: this.current.version,
      rationale: '',
      changelog: [],
      aiChanges: [],
      feedback: [],
      costUsd: null,
      instruction: '',
    };
    p.content = policy;
    if (change.kind === 'edit') p.aiChanges.push(change.changelog || t('aiEdit.updated'));
    else p.aiChanges.pop();
    // Undoing every AI edit of a proposal that only had AI edits: back to the saved policy.
    this.proposal = p.feedback.length || p.aiChanges.length ? p : null;
    this.renderProposal();
  }

  private async refresh(): Promise<void> {
    show(this.proposalSlot, spinner(t('calibration.refreshingLong')));
    const instruction = this.instruction.value.trim();
    const [current, proposal] = await Promise.all([optionsApi.getPolicy(), optionsApi.refresh({ instruction })]);
    if (!proposal.ok) {
      show(this.proposalSlot, errorNotice(proposal.error, proposal.status, t('calibration.cannotRefresh')));
      return;
    }
    if (!current.ok) {
      show(this.proposalSlot, errorNotice(current.error, current.status, t('common.cannotReadPolicy')));
      return;
    }
    this.current = current.data;
    this.proposal = fromRefresh(proposal.data, instruction);
    this.aiEdit.reset();
    this.renderProposal();
    pulseStatues();
    this.proposalSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private discard(): void {
    this.proposal = null;
    this.aiEdit.reset();
    this.syncAiEdit();
    this.aiEdit.close();
    show(this.proposalSlot);
  }

  private renderProposal(): void {
    this.syncAiEdit();
    const p = this.proposal;
    const current = this.current;
    if (!p || !current) {
      show(this.proposalSlot);
      return;
    }
    const status = h('div', { className: 'status-slot' });
    const accept = button(t('calibration.accept'), () => void withBusy(accept, t('common.saving'), () => this.accept(p, status)), 'primary');
    const discard = button(t('common.discard'), () => this.discard(), 'ghost');
    const cost = p.costUsd !== null ? t('calibration.cost', { cost: usd(p.costUsd) }) : '';
    const changelog = [...p.changelog, ...p.aiChanges.map((c) => `✨ ${c}`)];
    show(
      this.proposalSlot,
      h(
        'section',
        { className: 'proposal' },
        rationaleBox(p.rationale, changelog, t('calibration.proposal')),
        h('p', {
          className: 'muted small',
          text: p.feedback.length ? tn(p.feedback.length, 'calibration.basedOn', { version: p.baseVersion, cost }) : t('calibration.aiBased', { version: p.baseVersion }),
        }),
        p.instruction ? h('p', { className: 'muted small', text: t('calibration.instructionUsed', { text: p.instruction }) }) : null,
        policyDiffView(current.content, p.content),
        this.aiEdit.element,
        h('div', { className: 'actions' }, status, discard, accept),
      ),
    );
  }

  private async accept(p: Proposal, status: HTMLElement): Promise<void> {
    const save = () => optionsApi.savePolicy({ content: p.content }, p.baseVersion, p.feedback);
    let res = await save();
    if (!res.ok && (res.status === 401 || res.status === 403)) {
      // Unlocked in another tab since this page loaded: pick up that session's CSRF token and retry once.
      const lock = await lockApi.status();
      if (lock.ok && lock.data.session) res = await save();
    }
    if (!res.ok) {
      show(status, saveError(res.error, res.status));
      return;
    }
    const incorporated = res.data.incorporated ?? 0;
    this.current = res.data;
    this.proposal = null;
    this.instruction.value = '';
    this.aiEdit.reset();
    this.syncAiEdit();
    this.aiEdit.close();
    await markPolicySaved();
    pulseStatues();
    show(
      this.proposalSlot,
      notice(
        'ok',
        h('strong', { text: t('common.policySavedVersion', { version: res.data.version }) }),
        p.feedback.length ? h('p', { text: tn(incorporated, 'calibration.incorporated') }) : '',
      ),
    );
    await this.load();
  }
}

function fromRefresh(r: RefreshResult, instruction: string): Proposal {
  return {
    content: r.content,
    baseVersion: r.base_version,
    rationale: r.rationale,
    changelog: r.changelog,
    aiChanges: [],
    feedback: r.feedback,
    costUsd: r.usage.cost_usd,
    instruction,
  };
}

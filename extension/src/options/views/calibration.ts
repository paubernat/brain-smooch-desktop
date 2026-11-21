// "Calibración" card on the landing: labels not yet incorporated into the
// policy and a button that asks Claude for a revised policy from them. The
// proposal is shown as a diff + changelog; accepting saves it (new version),
// marks those labels as incorporated and sends a pulse through the statues.
// Only the dev split is used.
import { optionsApi } from '../api';
import { corners } from '../components/frame';
import { policyDiffView } from '../components/policy-diff-view';
import { rationaleBox } from '../components/rationale';
import { pulseStatues } from '../components/statue';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { usd } from '../format';
import { t, tn } from '../i18n';
import { markPolicySaved } from '../setup-state';
import type { FeedbackItem, FeedbackSummary, Label } from '../../types';
import type { PolicyOut, RefreshResult } from '../types';

const MAX_LISTED = 50;
const TIER_ORDER: readonly Label[] = ['LIBRE', 'LIMITADO', 'NO'];

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

export class CalibrationCard {
  readonly element = h('section', { className: 'calibration-card', attrs: { id: 'calibracion', 'aria-labelledby': 'calibration-title' } });
  private readonly summarySlot = h('div');
  private readonly proposalSlot = h('div');

  constructor(private focus = false) {
    this.element.append(
      ...corners(),
      h('header', {}, h('span', { className: 'mode-icon', text: '⟳', attrs: { 'aria-hidden': 'true' } }), h('h2', { text: t('calibration.title'), attrs: { id: 'calibration-title' } })),
      h('p', { className: 'muted', text: t('calibration.lead') }),
      this.summarySlot,
      this.proposalSlot,
    );
    void this.load();
  }

  private async load(): Promise<void> {
    show(this.summarySlot, spinner(t('calibration.counting')));
    const res = await optionsApi.feedback();
    if (!res.ok) {
      show(this.summarySlot, errorNotice(res.error, res.status, t('calibration.cannotRead')));
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
    const summary = t('calibration.summary', {
      withReason: t('calibration.withReason', { n: f.with_reason }),
      pendingTest: tn(f.pending_test, 'calibration.pendingTest'),
      devOnly: t('calibration.devOnly'),
    });
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
        refresh,
      ),
      f.pending >= f.hint_threshold ? notice('warn', t('calibration.hint', { n: f.pending })) : null,
      pendingList(f.items),
    );
  }

  private async refresh(): Promise<void> {
    show(this.proposalSlot, spinner(t('calibration.refreshingLong')));
    const [current, proposal] = await Promise.all([optionsApi.getPolicy(), optionsApi.refresh()]);
    if (!proposal.ok) {
      show(this.proposalSlot, errorNotice(proposal.error, proposal.status, t('calibration.cannotRefresh')));
      return;
    }
    if (!current.ok) {
      show(this.proposalSlot, errorNotice(current.error, current.status, t('common.cannotReadPolicy')));
      return;
    }
    this.renderProposal(current.data, proposal.data);
    pulseStatues();
    this.proposalSlot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private renderProposal(current: PolicyOut, p: RefreshResult): void {
    const status = h('div', { className: 'status-slot' });
    const accept = button(t('calibration.accept'), () => void withBusy(accept, t('common.saving'), () => this.accept(p, status)), 'primary');
    const discard = button(t('common.discard'), () => show(this.proposalSlot), 'ghost');
    const cost = p.usage.cost_usd !== null ? t('calibration.cost', { cost: usd(p.usage.cost_usd) }) : '';
    show(
      this.proposalSlot,
      h(
        'section',
        { className: 'proposal' },
        rationaleBox(p.rationale, p.changelog, t('calibration.proposal')),
        h('p', { className: 'muted small', text: tn(p.feedback.length, 'calibration.basedOn', { version: p.base_version, cost }) }),
        policyDiffView(current.content, p.content),
        h('div', { className: 'actions' }, status, discard, accept),
      ),
    );
  }

  private async accept(p: RefreshResult, status: HTMLElement): Promise<void> {
    const res = await optionsApi.savePolicy({ content: p.content }, p.base_version, p.feedback);
    if (!res.ok) {
      show(status, errorNotice(res.error, res.status, t('common.cannotSave')));
      return;
    }
    const incorporated = res.data.incorporated ?? 0;
    await markPolicySaved();
    pulseStatues();
    show(
      this.proposalSlot,
      notice(
        'ok',
        h('strong', { text: t('common.policySavedVersion', { version: res.data.version }) }),
        h('p', { text: tn(incorporated, 'calibration.incorporated') }),
      ),
    );
    await this.load();
  }
}

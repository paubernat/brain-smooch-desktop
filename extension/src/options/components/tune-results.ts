// Rendering pieces of "Probar política": estimate, metrics, misclassified table, proposal.
import { TIER_INFO, tierBlurb, tierHeader } from './policy-editor';
import { notice } from './status';
import { button, h } from '../dom';
import { percent, usd } from '../format';
import { t, tn } from '../i18n';
import type { EvalOutcome, Misclassified, RefineResult } from '../types';
import { rationaleBox } from './rationale';

export function estimateLine(e: EvalOutcome): HTMLElement {
  const text =
    e.calls === 0
      ? t('results.allCached', { verdicts: tn(e.cached, 'results.verdicts') })
      : t('results.estimate', { calls: tn(e.calls, 'results.calls'), cached: e.cached, cost: usd(e.est_cost_usd) });
  return h('p', { className: 'estimate' }, h('strong', { text: t('results.estimateHead', { n: e.n_dev, judge: e.judge, config: e.config }) }), text);
}

function metric(label: string, value: string, tone = ''): HTMLElement {
  return h('div', { className: `metric ${tone}` }, h('span', { className: 'metric-value', text: value }), h('span', { className: 'metric-label', text: label }));
}

export function metricsRow(e: EvalOutcome): HTMLElement {
  return h(
    'div',
    { className: 'metrics' },
    metric(t('results.accuracy'), percent(e.accuracy)),
    metric(t('results.falseLibre'), String(e.false_libre), e.false_libre > 0 ? 'bad' : 'good'),
    metric(t('results.errors'), String(e.errors.length)),
    metric(t('results.cost'), usd(e.cost_usd)),
  );
}

function labelPill(label: string): HTMLElement {
  return h('span', { className: `pill tier-${label}`, text: label });
}

export function errorsTable(errors: Misclassified[]): HTMLElement {
  if (!errors.length) return notice('ok', t('results.noErrors'));
  return h(
    'div',
    { className: 'table-wrap' },
    h(
      'table',
      { className: 'errors' },
      h('thead', {}, h('tr', {}, ...[t('results.colVideo'), t('results.colTruth'), t('results.colPredicted'), t('results.colConfidence')].map((text) => h('th', { text })))),
      h(
        'tbody',
        {},
        ...errors.map((e) =>
          h(
            'tr',
            { className: e.predicted === 'LIBRE' ? 'false-libre' : '' },
            h(
              'td',
              {},
              h('a', { text: e.title || e.video_id, attrs: { href: e.url, target: '_blank', rel: 'noopener noreferrer' } }),
              e.channel ? h('span', { className: 'muted small block', text: e.channel }) : null,
            ),
            h('td', {}, labelPill(e.truth)),
            h('td', {}, labelPill(e.predicted)),
            h('td', { className: 'num', text: percent(e.confidence) }),
          ),
        ),
      ),
    ),
  );
}

export function proposalPanel(p: RefineResult, onAccept: () => void, onReject: () => void): HTMLElement {
  const q = p.content.question;
  return h(
    'section',
    { className: 'proposal' },
    rationaleBox(p.rationale, p.changelog, t('results.proposal')),
    h('p', { className: 'muted small', text: q.instructions }),
    h(
      'div',
      { className: 'tier-grid' },
      ...TIER_INFO.map(({ label }) =>
        h('section', { className: `quote tier-${label}` }, tierHeader(label, tierBlurb(label)), h('p', { className: 'pre', text: q.options[label].description })),
      ),
    ),
    h('div', { className: 'actions' }, button(t('results.reject'), onReject, 'ghost'), button(t('results.accept'), onAccept, 'primary')),
  );
}

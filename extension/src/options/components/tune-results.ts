// Rendering pieces of "Probar política": estimate, metrics, misclassified table, proposal.
import { TIER_INFO, tierHeader } from './policy-editor';
import { notice } from './status';
import { button, h } from '../dom';
import { percent, plural, usd } from '../format';
import type { EvalOutcome, Misclassified, RefineResult } from '../types';
import { rationaleBox } from './rationale';

export function estimateLine(e: EvalOutcome): HTMLElement {
  const text =
    e.calls === 0
      ? `Todo en caché: ${plural(e.cached, 'veredicto', 'veredictos')}, sin coste.`
      : `${plural(e.calls, 'llamada nueva', 'llamadas nuevas')} · ${e.cached} en caché · ≈ ${usd(e.est_cost_usd)}`;
  return h('p', { className: 'estimate' }, h('strong', { text: `${e.n_dev} vídeos dev con ${e.judge} (config ${e.config}): ` }), text);
}

function metric(label: string, value: string, tone = ''): HTMLElement {
  return h('div', { className: `metric ${tone}` }, h('span', { className: 'metric-value', text: value }), h('span', { className: 'metric-label', text: label }));
}

export function metricsRow(e: EvalOutcome): HTMLElement {
  return h(
    'div',
    { className: 'metrics' },
    metric('Acierto', percent(e.accuracy)),
    metric('Falsos LIBRE', String(e.false_libre), e.false_libre > 0 ? 'bad' : 'good'),
    metric('Errores', String(e.errors.length)),
    metric('Coste de esta evaluación', usd(e.cost_usd)),
  );
}

function labelPill(label: string): HTMLElement {
  return h('span', { className: `pill tier-${label}`, text: label });
}

export function errorsTable(errors: Misclassified[]): HTMLElement {
  if (!errors.length) return notice('ok', 'Sin errores en dev con este borrador.');
  return h(
    'div',
    { className: 'table-wrap' },
    h(
      'table',
      { className: 'errors' },
      h('thead', {}, h('tr', {}, ...['Vídeo', 'Tu etiqueta', 'Predicho', 'Confianza'].map((t) => h('th', { text: t })))),
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
    rationaleBox(p.rationale, p.changelog, 'Propuesta de mejora'),
    h('p', { className: 'muted small', text: q.instructions }),
    h(
      'div',
      { className: 'tier-grid' },
      ...TIER_INFO.map(({ label, blurb }) =>
        h('section', { className: `quote tier-${label}` }, tierHeader(label, blurb), h('p', { className: 'pre', text: q.options[label].description })),
      ),
    ),
    h('div', { className: 'actions' }, button('Rechazar', onReject, 'ghost'), button('Aceptar propuesta', onAccept, 'primary')),
  );
}

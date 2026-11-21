// "Juez en directo" card on the landing: which judge and information levels
// decide the verdict shown in the YouTube panel, and when it is revealed.
// Every change is saved right away (PUT /settings/live).
import { optionsApi } from '../api';
import { corners } from '../components/frame';
import { configSelectFor, judgeSelectFor } from '../components/policy-tester';
import { errorNotice, notice, show, spinner } from '../components/status';
import { field, h } from '../dom';
import { t } from '../i18n';
import { describeConfig, judgeWarning } from '../live-settings';
import type { LiveSettings } from '../../types';
import type { JudgesOut } from '../types';

export class LiveJudgeCard {
  readonly element = h('section', { className: 'calibration-card live-judge-card', attrs: { id: 'juez', 'aria-labelledby': 'live-judge-title' } });
  private readonly body = h('div', {}, spinner(t('live.loading')));
  private readonly status = h('div', { className: 'status-slot' });

  constructor() {
    this.element.append(
      ...corners(),
      h('header', {}, h('span', { className: 'mode-icon', text: '⚖', attrs: { 'aria-hidden': 'true' } }), h('h2', { text: t('live.title'), attrs: { id: 'live-judge-title' } })),
      h('p', { className: 'muted', text: t('live.lead') }),
      this.body,
      this.status,
    );
    void this.load();
  }

  private async load(): Promise<void> {
    const [settings, judges] = await Promise.all([optionsApi.liveSettings(), optionsApi.judges()]);
    if (!settings.ok) return show(this.body, errorNotice(settings.error, settings.status, t('live.cannotRead')));
    if (!judges.ok) return show(this.body, errorNotice(judges.error, judges.status, t('tester.cannotLoadJudges')));
    this.render(settings.data, judges.data);
  }

  private render(current: LiveSettings, judges: JudgesOut): void {
    let settings = current;
    const judgeSelect = judgeSelectFor(judges, settings.judge);
    const configSelect = configSelectFor(judges, settings.config, describeConfig);
    const reveal = h('input', { attrs: { type: 'checkbox' } });
    reveal.checked = settings.reveal === 'always';
    const warning = h('div');
    const showWarning = () => {
      const text = judgeWarning(settings, judges);
      show(warning, text ? notice('warn', text) : null);
    };
    const save = async (next: LiveSettings) => {
      const res = await optionsApi.saveLiveSettings(next);
      if (!res.ok) {
        show(this.status, errorNotice(res.error, res.status, t('common.cannotSave')));
        return;
      }
      settings = res.data;
      showWarning();
      show(this.status, h('p', { className: 'muted small', text: t('live.saved') }));
    };
    judgeSelect.addEventListener('change', () => void save({ ...settings, judge: judgeSelect.value }));
    configSelect.addEventListener('change', () => void save({ ...settings, config: configSelect.value }));
    reveal.addEventListener('change', () => void save({ ...settings, reveal: reveal.checked ? 'always' : 'after_label' }));
    showWarning();
    show(
      this.body,
      h('div', { className: 'controls' }, field(t('common.judge'), judgeSelect), field(t('common.levels'), configSelect, t('live.levelsHint'))),
      h(
        'div',
        { className: 'reveal-row' },
        h('label', { className: 'switch' }, reveal, h('span', { text: t('live.reveal') })),
        h('p', { className: 'muted small', text: t('live.revealNote', { explanation: t('live.revealExplanation') }) }),
      ),
      warning,
    );
  }
}

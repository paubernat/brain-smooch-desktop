// "Protection" card (dashboard and #candado): blocking in Firefox on/off, the
// Shorts feed rule, the daily LIMITADO quota (with today's meter). Tightening
// saves at once; relaxing needs the admin session (the error notice says so).
import { formatMinutes, usedFraction } from '../../enforce/quota-view';
import type { EnforcementSettings, QuotaToday } from '../../types';
import { optionsApi } from '../api';
import { corners } from '../components/frame';
import { errorNotice, show, spinner } from '../components/status';
import { button, field, h, withBusy } from '../dom';
import { t } from '../i18n';

export function quotaMeter(quota: QuotaToday): HTMLElement {
  const fill = h('span', { className: 'quota-fill' });
  fill.style.width = `${Math.round(usedFraction(quota) * 100)}%`;
  return h(
    'div',
    { className: `quota-meter${quota.exhausted ? ' exhausted' : ''}` },
    h('span', { className: 'quota-bar' }, fill),
    h('span', { className: 'mono small', text: t('quota.today', { used: formatMinutes(quota.used_s), daily: formatMinutes(quota.daily_s), left: formatMinutes(quota.remaining_s) }) }),
  );
}

export class ProtectionCard {
  readonly element = h('section', { className: 'calibration-card protection-card', attrs: { id: 'proteccion', 'aria-labelledby': 'protection-title' } });
  private readonly body = h('div', {}, spinner(t('protection.loading')));
  private readonly status = h('div', { className: 'status-slot' });

  constructor() {
    this.element.append(
      ...corners(),
      h('header', {}, h('span', { className: 'mode-icon', text: '🛡', attrs: { 'aria-hidden': 'true' } }), h('h2', { text: t('protection.title'), attrs: { id: 'protection-title' } })),
      h('p', { className: 'muted', text: t('protection.lead') }),
      this.body,
      this.status,
    );
    void this.load();
  }

  private async load(): Promise<void> {
    const [enforcement, quota, today] = await Promise.all([optionsApi.enforcement(), optionsApi.quotaSettings(), optionsApi.quotaToday()]);
    if (!enforcement.ok) return show(this.body, errorNotice(enforcement.error, enforcement.status, t('protection.cannotRead')));
    if (!quota.ok) return show(this.body, errorNotice(quota.error, quota.status, t('protection.cannotRead')));
    this.render(enforcement.data, quota.data.daily_minutes, today.ok ? today.data : null);
  }

  private saved(): void {
    show(this.status, h('p', { className: 'muted small', text: t('live.saved') }));
  }

  private render(initial: EnforcementSettings, dailyMinutes: number, today: QuotaToday | null): void {
    let settings = initial;
    const toggle = (checked: boolean, text: string, onChange: (input: HTMLInputElement) => void) => {
      const input = h('input', { attrs: { type: 'checkbox' } });
      input.checked = checked;
      input.addEventListener('change', () => onChange(input));
      return h('label', { className: 'switch' }, input, h('span', { text }));
    };
    const saveEnforcement = async (next: EnforcementSettings, input: HTMLInputElement) => {
      const res = await optionsApi.saveEnforcement(next);
      if (!res.ok) {
        input.checked = !input.checked;
        return show(this.status, errorNotice(res.error, res.status, t('common.cannotSave')));
      }
      settings = res.data;
      this.saved();
    };
    const minutes = h('input', { attrs: { type: 'number', min: '0', max: '1440', step: '5' } });
    minutes.value = String(dailyMinutes);
    const saveQuota = button(t('protection.saveQuota'), () =>
      void withBusy(saveQuota, t('common.saving'), async () => {
        const value = Math.max(0, Math.min(1440, Math.round(Number(minutes.value) || 0)));
        const res = await optionsApi.saveQuotaSettings({ daily_minutes: value });
        if (!res.ok) return show(this.status, errorNotice(res.error, res.status, t('common.cannotSave')));
        minutes.value = String(res.data.daily_minutes);
        this.saved();
        const fresh = await optionsApi.quotaToday();
        if (fresh.ok) show(meterSlot, quotaMeter(fresh.data));
      }),
    );
    const meterSlot = h('div', {}, today ? quotaMeter(today) : '');
    show(
      this.body,
      h(
        'div',
        { className: 'reveal-row' },
        toggle(settings.mode === 'soft', t('protection.enforce'), (input) => void saveEnforcement({ ...settings, mode: input.checked ? 'soft' : 'off' }, input)),
        h('p', { className: 'muted small', text: t('protection.enforceHint', { seconds: settings.service_timeout_s }) }),
      ),
      h(
        'div',
        { className: 'reveal-row' },
        toggle(settings.block_shorts_feed, t('protection.shorts'), (input) => void saveEnforcement({ ...settings, block_shorts_feed: input.checked }, input)),
        h('p', { className: 'muted small', text: t('protection.shortsHint') }),
      ),
      h('div', { className: 'controls' }, field(t('protection.quota'), minutes, t('protection.quotaHint'))),
      h('div', { className: 'actions inline' }, saveQuota),
      meterSlot,
    );
  }
}

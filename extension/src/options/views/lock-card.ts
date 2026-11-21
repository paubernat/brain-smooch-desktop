// "Lock" card (dashboard and #candado): unlock with the custodian's password
// (10-minute admin session), lock again, the optional delay for relaxing, the
// pending relax requests (cancelling one needs no password) and the kit.
import { corners } from '../components/frame';
import { errorNotice, formatWhen, notice, show, spinner } from '../components/status';
import { button, field, h, withBusy } from '../dom';
import { t } from '../i18n';
import { lockApi, onLockStatus, sessionSecondsLeft, type LockStatus, type RelaxRequest } from '../lock-client';
import { hrefFor } from '../router';

const DELAY_HOURS = 24;

export class LockCard {
  readonly element = h('section', { className: 'calibration-card lock-card', attrs: { id: 'candado', 'aria-labelledby': 'lock-title' } });
  private readonly body = h('div', {}, spinner(t('lock.loading')));
  private readonly requests = h('div');
  private readonly status = h('div', { className: 'status-slot' });

  constructor() {
    this.element.append(
      ...corners(),
      h('header', {}, h('span', { className: 'mode-icon', text: '🔒', attrs: { 'aria-hidden': 'true' } }), h('h2', { text: t('lock.title'), attrs: { id: 'lock-title' } })),
      h('p', { className: 'muted', text: t('lock.lead') }),
      this.body,
      this.status,
      this.requests,
    );
    onLockStatus((status) => this.element.isConnected && this.render(status));
    void this.load();
  }

  private async load(): Promise<void> {
    const res = await lockApi.status();
    if (!res.ok) return show(this.body, errorNotice(res.error, res.status, t('lock.cannotRead')));
    this.render(res.data);
    void this.loadRequests();
  }

  private render(status: LockStatus): void {
    if (!status.password_set) {
      show(this.body, notice('warn', h('p', { text: t('lock.noPassword') }), h('a', { className: 'btn primary', text: t('lock.createPassword'), attrs: { href: hrefFor('custodian') } })));
      return;
    }
    show(this.body, sessionSecondsLeft(status) > 0 ? this.unlocked(status) : this.locked(status));
  }

  private locked(status: LockStatus): HTMLElement {
    const password = h('input', { attrs: { type: 'password', autocomplete: 'current-password', maxlength: '256' } });
    const unlock = button(t('lock.unlock'), () =>
      void withBusy(unlock, t('lock.unlocking'), async () => {
        const res = await lockApi.login(password.value);
        password.value = '';
        if (res.ok) return show(this.status);
        show(this.status, res.status === 401 ? notice('error', t('lock.wrong')) : errorNotice(res.error, res.status, t('lock.cannotUnlock')));
      }),
    'primary');
    password.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') unlock.click();
    });
    const wait = status.retry_after_s > 0 ? notice('warn', t('lock.wait', { seconds: Math.ceil(status.retry_after_s) })) : null;
    return h(
      'div',
      {},
      h('p', { className: 'lock-state locked mono', text: t('lock.locked', { name: status.custodian }) }),
      wait ?? '',
      h('div', { className: 'controls' }, field(t('lock.password'), password)),
      h('div', { className: 'actions inline' }, unlock, h('a', { className: 'btn ghost', text: t('lock.kit'), attrs: { href: hrefFor('kit'), target: '_blank', rel: 'noopener' } })),
    );
  }

  private unlocked(status: LockStatus): HTMLElement {
    const minutes = Math.ceil(sessionSecondsLeft(status) / 60);
    const lock = button(t('lock.lockNow'), () => void lockApi.logout());
    const delay = h('input', { attrs: { type: 'checkbox' } });
    delay.checked = status.relax_delay_hours > 0;
    delay.addEventListener('change', () => {
      void lockApi.saveDelay(delay.checked ? DELAY_HOURS : 0).then((res) => {
        if (!res.ok) {
          delay.checked = !delay.checked;
          show(this.status, errorNotice(res.error, res.status, t('common.cannotSave')));
        } else show(this.status, h('p', { className: 'muted small', text: t('live.saved') }));
      });
    });
    return h(
      'div',
      {},
      h('p', { className: 'lock-state unlocked mono', text: t('lock.unlocked', { minutes }) }),
      h('label', { className: 'switch' }, delay, h('span', { text: t('custodian.delay') })),
      h('p', { className: 'muted small', text: t('custodian.delayHint') }),
      h('div', { className: 'actions inline' }, lock, h('a', { className: 'btn ghost', text: t('lock.kit'), attrs: { href: hrefFor('kit'), target: '_blank', rel: 'noopener' } })),
    );
  }

  private async loadRequests(): Promise<void> {
    const res = await lockApi.requests();
    if (!res.ok) return;
    this.renderRequests(res.data);
  }

  private renderRequests(all: RelaxRequest[]): void {
    const pending = all.filter((r) => r.status === 'pending');
    if (!pending.length) return show(this.requests);
    show(
      this.requests,
      h(
        'div',
        { className: 'relax-requests' },
        h('h3', { className: 'section-title mono', text: t('lock.requests') }),
        h(
          'ul',
          {},
          ...pending.map((r) =>
            h(
              'li',
              {},
              h('span', { text: t('lock.request', { what: r.summary.join(', '), when: formatWhen(r.apply_after) }) }),
              button(t('lock.cancel'), () => void lockApi.cancel(r.id).then((res) => res.ok && this.renderRequests(res.data)), 'ghost'),
            ),
          ),
        ),
      ),
    );
  }
}

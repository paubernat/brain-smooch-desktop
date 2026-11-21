// "Custodian" (#custodio): the last onboarding step, right before the rocket.
// Name of the trusted person, the app password typed twice and the optional
// 24 h delay for relaxing. Only the argon2id hash is stored by the service.
// Afterwards: print the recovery kit and launch.
import { viewHeader } from '../components/header';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, field, h, withBusy } from '../dom';
import { t } from '../i18n';
import { launchSystem } from '../launch-flow';
import { lockApi, type LockStatus } from '../lock-client';
import { go, hrefFor } from '../router';
import { isSetupComplete, loadSetup } from '../setup-state';

export const MIN_PASSWORD_LENGTH = 8;
const DELAY_HOURS = 24;

/** Client-side check of the form (the service checks again). */
export function custodianFormError(name: string, password: string, confirm: string): string | null {
  if (!name.trim()) return t('custodian.error.name');
  if (password.length < MIN_PASSWORD_LENGTH) return t('custodian.error.short', { min: MIN_PASSWORD_LENGTH });
  if (password !== confirm) return t('custodian.error.mismatch');
  return null;
}

export function renderCustodian(): HTMLElement {
  const body = h('div', {}, spinner(t('lock.loading')));
  void load(body);
  return h('div', { className: 'view custodian' }, viewHeader(t('custodian.title'), t('custodian.lead'), t('custodian.eyebrow')), body);
}

async function load(body: HTMLElement): Promise<void> {
  const res = await lockApi.status();
  if (!res.ok) {
    show(body, errorNotice(res.error, res.status, t('lock.cannotRead')), button(t('common.retry'), () => void load(body)));
    return;
  }
  if (res.data.password_set) show(body, done(res.data));
  else show(body, form(body));
}

function input(type: string, autocomplete: string): HTMLInputElement {
  return h('input', { attrs: { type, autocomplete, maxlength: type === 'password' ? '256' : '100', spellcheck: 'false' } });
}

function form(body: HTMLElement): HTMLElement {
  const name = input('text', 'off');
  const password = input('password', 'new-password');
  const confirm = input('password', 'new-password');
  const delay = h('input', { attrs: { type: 'checkbox' } });
  const status = h('div', { className: 'status-slot' });
  const submit = button(t('custodian.save'), () =>
    void withBusy(submit, t('common.saving'), async () => {
      const error = custodianFormError(name.value, password.value, confirm.value);
      if (error) return show(status, notice('error', error));
      const res = await lockApi.setup(name.value.trim(), password.value, confirm.value, delay.checked ? DELAY_HOURS : 0);
      password.value = '';
      confirm.value = '';
      if (!res.ok) return show(status, errorNotice(res.error, res.status, t('common.cannotSave')));
      show(body, done(res.data));
    }),
  'primary');
  return h(
    'div',
    { className: 'custodian-form' },
    notice('info', h('strong', { text: t('custodian.who.title') }), h('p', { text: t('custodian.who.text') })),
    field(t('custodian.name'), name, t('custodian.nameHint')),
    field(t('custodian.password'), password, t('custodian.passwordHint', { min: MIN_PASSWORD_LENGTH })),
    field(t('custodian.confirm'), confirm),
    h('label', { className: 'switch' }, delay, h('span', { text: t('custodian.delay') })),
    h('p', { className: 'muted small', text: t('custodian.delayHint') }),
    h('div', { className: 'actions' }, status, submit),
  );
}

function done(status: LockStatus): HTMLElement {
  const launchStatus = h('div', { className: 'status-slot' });
  const launch = button(t('custodian.launch'), () =>
    void withBusy(launch, t('custodian.launching'), async () => {
      if (!isSetupComplete(await loadSetup())) return go('landing');
      const res = await launchSystem();
      if (!res.ok) return show(launchStatus, errorNotice(res.error ?? '', res.status ?? null, t('common.cannotSave')));
      go('landing');
    }),
  'primary');
  return h(
    'div',
    {},
    notice('ok', h('strong', { text: t('custodian.done.title', { name: status.custodian }) }), h('p', { text: t('custodian.done.text') })),
    h(
      'div',
      { className: 'actions inline' },
      h('a', { className: 'btn secondary', text: t('custodian.kit'), attrs: { href: hrefFor('kit'), target: '_blank', rel: 'noopener' } }),
      launch,
    ),
    launchStatus,
  );
}

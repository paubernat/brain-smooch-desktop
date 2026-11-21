// Loading, notices and error messages shared by every view.
import { h } from '../dom';
import { currentLocale, t } from '../i18n';
import { hrefFor } from '../router';

export const START_COMMAND = 'cd service && uv run python -m app';

export function spinner(text: string): HTMLElement {
  return h('div', { className: 'loading', attrs: { role: 'status' } }, h('span', { className: 'spinner' }), h('span', { text }));
}

export function notice(kind: 'info' | 'ok' | 'warn' | 'error', ...content: (Node | string)[]): HTMLElement {
  return h('div', { className: `notice ${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } }, ...content);
}

/** `status === null` means the request never reached the service. */
export function errorNotice(error: string, status: number | null, context = t('status.somethingFailed')): HTMLElement {
  if (status === null) {
    return notice(
      'error',
      h('strong', { text: t('status.unreachable') }),
      h('p', { text: t('status.startIt') }),
      h('code', { className: 'command', text: START_COMMAND }),
    );
  }
  if (status === 401 || status === 403) {
    // A change that relaxes the protection: it needs the custodian's password.
    return notice(
      'warn',
      h('strong', { text: t('lock.needed.title') }),
      h('p', { text: t('lock.needed.text') }),
      h('a', { className: 'btn primary', text: t('lock.needed.cta'), attrs: { href: hrefFor('lock') } }),
    );
  }
  if (status === 202) {
    // Relax request stored: it applies after the configured delay (`error` = apply_after).
    return notice('info', h('strong', { text: t('lock.deferred.title') }), h('p', { text: t('lock.deferred.text', { when: formatWhen(error) }) }));
  }
  return notice('error', h('strong', { text: `${context}.` }), h('p', { className: 'detail', text: describeError(error, status) }));
}

/** ISO date -> local date and time in the UI language. */
export function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

function describeError(error: string, status: number): string {
  if (status === 503 && /API_KEY/.test(error)) {
    const key = /([A-Z_]+_API_KEY)/.exec(error)?.[1] ?? t('status.theApiKey');
    return t('status.missingKey', { key });
  }
  if (status === 409) return t('status.conflict');
  if (status === 502) return t('status.badModel', { error });
  if (status === 429) return t('lock.tooMany');
  return `${error} (HTTP ${status})`;
}

/** Replaces the children of a slot element (status area, results...). */
export function show(slot: HTMLElement, ...content: (Node | null)[]): void {
  slot.replaceChildren(...content.filter((n): n is Node => n !== null));
}

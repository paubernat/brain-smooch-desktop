// Loading, notices and error messages shared by every view.
import { h } from '../dom';
import { t } from '../i18n';

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
  return notice('error', h('strong', { text: `${context}.` }), h('p', { className: 'detail', text: describeError(error, status) }));
}

function describeError(error: string, status: number): string {
  if (status === 503 && /API_KEY/.test(error)) {
    const key = /([A-Z_]+_API_KEY)/.exec(error)?.[1] ?? t('status.theApiKey');
    return t('status.missingKey', { key });
  }
  if (status === 409) return t('status.conflict');
  if (status === 502) return t('status.badModel', { error });
  return `${error} (HTTP ${status})`;
}

/** Replaces the children of a slot element (status area, results...). */
export function show(slot: HTMLElement, ...content: (Node | null)[]): void {
  slot.replaceChildren(...content.filter((n): n is Node => n !== null));
}

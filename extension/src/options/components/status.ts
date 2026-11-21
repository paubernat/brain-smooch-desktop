// Loading, notices and error messages shared by every view.
import { h } from '../dom';

export const START_COMMAND = 'cd service && uv run python -m app';

export function spinner(text: string): HTMLElement {
  return h('div', { className: 'loading', attrs: { role: 'status' } }, h('span', { className: 'spinner' }), h('span', { text }));
}

export function notice(kind: 'info' | 'ok' | 'warn' | 'error', ...content: (Node | string)[]): HTMLElement {
  return h('div', { className: `notice ${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } }, ...content);
}

/** `status === null` means the request never reached the service. */
export function errorNotice(error: string, status: number | null, context = 'Algo ha fallado'): HTMLElement {
  if (status === null) {
    return notice(
      'error',
      h('strong', { text: 'No se puede conectar con el servicio local.' }),
      h('p', { text: 'Arráncalo en una terminal y vuelve a intentarlo:' }),
      h('code', { className: 'command', text: START_COMMAND }),
    );
  }
  return notice('error', h('strong', { text: `${context}.` }), h('p', { className: 'detail', text: describeError(error, status) }));
}

function describeError(error: string, status: number): string {
  if (status === 503 && /API_KEY/.test(error)) {
    const key = /([A-Z_]+_API_KEY)/.exec(error)?.[1] ?? 'la clave de API';
    return `Falta ${key} en el .env de la raíz del repo. Añádela y reinicia el servicio.`;
  }
  if (status === 409) return 'La política ha cambiado en disco mientras la editabas. Recarga la página para ver la versión actual.';
  if (status === 502) return `El modelo no ha devuelto una respuesta utilizable (${error}). Vuelve a intentarlo.`;
  return `${error} (HTTP ${status})`;
}

/** Replaces the children of a slot element (status area, results...). */
export function show(slot: HTMLElement, ...content: (Node | null)[]): void {
  slot.replaceChildren(...content.filter((n): n is Node => n !== null));
}

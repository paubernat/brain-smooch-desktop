// "Why this draft" box: Claude's rationale and the list of changes.
import { h } from '../dom';
import { notice } from './status';

export function rationaleBox(rationale: string, changelog: string[], title = 'Por qué este borrador'): HTMLElement | null {
  if (!rationale && !changelog.length) return null;
  return notice(
    'info',
    h('strong', { text: title }),
    rationale ? h('p', { text: rationale }) : '',
    changelog.length ? h('ul', { className: 'changelog' }, ...changelog.map((c) => h('li', { text: c }))) : '',
  );
}

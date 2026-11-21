// "✨ Editar con IA": a small prompt box next to a policy editor. The user
// writes an instruction ("quita lo de Fireship"), Claude returns the edited
// policy and a one-line changelog, and the editable draft is replaced (with
// undo). Nothing is saved: the user still has to press the save button.
import { optionsApi } from '../api';
import { button, h, withBusy } from '../dom';
import type { PolicyContent } from '../types';
import { UndoStack } from '../undo';
import { policyDiffView } from './policy-diff-view';
import { errorNotice, notice, show } from './status';

export interface AiEditTarget {
  getPolicy(): PolicyContent;
  /** Replace the editable draft (and whatever state mirrors it). */
  setPolicy(policy: PolicyContent): void;
}

const EXAMPLES = 'p. ej. «añade que los podcasts de tecnología son LIMITADO» o «quita lo de Fireship»';

export class AiEditBox {
  /** The ✨ button that opens the box; place it in a toolbar. */
  readonly trigger: HTMLButtonElement;
  /** The box itself (hidden until the trigger is pressed). */
  readonly element: HTMLElement;
  private readonly input = h('textarea', { attrs: { rows: '2', placeholder: `Qué quieres cambiar… (${EXAMPLES})`, 'aria-label': 'Instrucción para la IA' } });
  private readonly status = h('div', { className: 'ai-edit-status' });
  private readonly undoButton: HTMLButtonElement;
  private readonly history = new UndoStack<PolicyContent>();

  constructor(private readonly target: AiEditTarget) {
    this.trigger = button('✨ Editar con IA', () => this.toggle(), 'secondary');
    this.trigger.classList.add('ai-trigger');
    this.trigger.title = 'Pide a la IA un cambio concreto en el borrador';
    const apply = button('Aplicar', () => void withBusy(apply, 'Editando…', () => this.apply()), 'primary');
    this.undoButton = button('Deshacer', () => this.undo(), 'ghost');
    this.undoButton.disabled = true;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        apply.click();
      }
      if (e.key === 'Escape') this.close();
    });
    this.element = h(
      'div',
      { className: 'ai-edit hidden' },
      h('p', { className: 'muted small', text: 'Describe un cambio y la IA lo aplica al borrador. Nada se guarda hasta que pulses «Guardar». Ctrl+Enter para aplicar.' }),
      this.input,
      h('div', { className: 'actions inline' }, apply, this.undoButton, button('Cerrar', () => this.close(), 'ghost')),
      this.status,
    );
  }

  private toggle(): void {
    const open = this.element.classList.toggle('hidden') === false;
    this.trigger.setAttribute('aria-expanded', String(open));
    if (open) this.input.focus();
  }

  private close(): void {
    this.element.classList.add('hidden');
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  private async apply(): Promise<void> {
    const instruction = this.input.value.trim();
    if (!instruction) {
      show(this.status, notice('warn', 'Escribe qué quieres cambiar.'));
      return;
    }
    const before = this.target.getPolicy();
    const res = await optionsApi.edit(before, instruction);
    if (!res.ok) {
      show(this.status, errorNotice(res.error, res.status, 'No se pudo editar con IA'));
      return;
    }
    this.history.push(before);
    this.target.setPolicy(res.data.content);
    this.input.value = '';
    this.undoButton.disabled = false;
    show(
      this.status,
      notice(
        'ok',
        h('strong', { text: '✨ ' }),
        res.data.changelog || 'Borrador actualizado.',
        h('details', { className: 'ai-edit-diff' }, h('summary', { text: 'Ver cambios' }), policyDiffView(before, res.data.content)),
      ),
    );
  }

  private undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.target.setPolicy(previous);
    this.undoButton.disabled = this.history.size === 0;
    show(this.status, notice('info', 'Cambio deshecho.'));
  }
}

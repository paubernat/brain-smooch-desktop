// "✨ Editar con IA": a small prompt box next to a policy editor. The user
// writes an instruction ("quita lo de Fireship"), Claude returns the edited
// policy and a one-line changelog, and the editable draft is replaced (with
// undo). Nothing is saved: the user still has to press the save button.
import { optionsApi } from '../api';
import { button, h, withBusy } from '../dom';
import { t } from '../i18n';
import type { PolicyContent } from '../types';
import { UndoStack } from '../undo';
import { policyDiffView } from './policy-diff-view';
import { errorNotice, notice, show } from './status';

/** Why the draft is being replaced: an AI edit (with its changelog) or an undo of the last one. */
export type AiEditChange = { kind: 'edit'; changelog: string } | { kind: 'undo' };

export interface AiEditTarget {
  getPolicy(): PolicyContent;
  /** Replace the editable draft (and whatever state mirrors it). */
  setPolicy(policy: PolicyContent, change: AiEditChange): void;
  /** The saved policy when `getPolicy()` is a proposal under review: the instruction then corrects that proposal. */
  getReference?(): PolicyContent | undefined;
}

/** Labels for hosts other than a draft editor (e.g. the calibration card). */
export interface AiEditOptions {
  trigger?: string;
  triggerTitle?: string;
  help?: string;
}

export class AiEditBox {
  /** The ✨ button that opens the box; place it in a toolbar. */
  readonly trigger: HTMLButtonElement;
  /** The box itself (hidden until the trigger is pressed). */
  readonly element: HTMLElement;
  private readonly input = h('textarea', { attrs: { rows: '2', placeholder: t('aiEdit.placeholder', { examples: t('aiEdit.examples') }), 'aria-label': t('aiEdit.inputLabel') } });
  private readonly status = h('div', { className: 'ai-edit-status' });
  private readonly undoButton: HTMLButtonElement;
  private readonly history = new UndoStack<PolicyContent>();
  private readonly help: HTMLElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly defaultPlaceholder: string;
  private inline = false;

  constructor(
    private readonly target: AiEditTarget,
    options: AiEditOptions = {},
  ) {
    this.trigger = button(options.trigger ?? t('aiEdit.trigger'), () => this.toggle(), 'secondary');
    this.trigger.classList.add('ai-trigger');
    this.trigger.title = options.triggerTitle ?? t('aiEdit.triggerTitle');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.help = h('p', { className: 'muted small', text: options.help ?? t('aiEdit.help') });
    const apply = button(t('aiEdit.apply'), () => void withBusy(apply, t('aiEdit.applying'), () => this.apply()), 'primary');
    this.undoButton = button(t('aiEdit.undo'), () => this.undo(), 'ghost');
    this.undoButton.disabled = true;
    this.closeButton = button(t('common.close'), () => this.close(), 'ghost');
    this.defaultPlaceholder = this.input.placeholder;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        apply.click();
      }
      if (e.key === 'Escape' && !this.inline) this.close();
    });
    this.element = h(
      'div',
      { className: 'ai-edit hidden' },
      this.help,
      this.input,
      h('div', { className: 'actions inline' }, apply, this.undoButton, this.closeButton),
      this.status,
    );
  }

  setHelp(text: string): void {
    this.help.textContent = text;
  }

  /**
   * Inline: always expanded, without a close button (the trigger is not used), e.g. attached
   * to a diff. Leaving inline mode keeps the box open so its last message stays visible.
   */
  setInline(inline: boolean, placeholder?: string): void {
    this.inline = inline;
    this.element.classList.toggle('inline', inline);
    this.closeButton.classList.toggle('hidden', inline);
    this.input.placeholder = placeholder ?? this.defaultPlaceholder;
    if (inline || !this.element.classList.contains('hidden')) {
      this.element.classList.remove('hidden');
      this.trigger.setAttribute('aria-expanded', 'true');
    }
  }

  /** Forget the undo history and the last message (the draft was replaced from outside). */
  reset(): void {
    this.history.clear();
    this.undoButton.disabled = true;
    show(this.status);
  }

  private toggle(): void {
    const open = this.element.classList.toggle('hidden') === false;
    this.trigger.setAttribute('aria-expanded', String(open));
    if (open) this.input.focus();
  }

  close(): void {
    this.element.classList.add('hidden');
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  private async apply(): Promise<void> {
    const instruction = this.input.value.trim();
    if (!instruction) {
      show(this.status, notice('warn', t('aiEdit.writeSomething')));
      return;
    }
    const before = this.target.getPolicy();
    const res = await optionsApi.edit(before, instruction, this.target.getReference?.());
    if (!res.ok) {
      show(this.status, errorNotice(res.error, res.status, t('aiEdit.failed')));
      return;
    }
    this.history.push(before);
    this.target.setPolicy(res.data.content, { kind: 'edit', changelog: res.data.changelog });
    this.input.value = '';
    this.undoButton.disabled = false;
    show(
      this.status,
      notice(
        'ok',
        h('strong', { text: '✨ ' }),
        res.data.changelog || t('aiEdit.updated'),
        h('details', { className: 'ai-edit-diff' }, h('summary', { text: t('aiEdit.showChanges') }), policyDiffView(before, res.data.content)),
      ),
    );
  }

  private undo(): void {
    const previous = this.history.pop();
    if (!previous) return;
    this.target.setPolicy(previous, { kind: 'undo' });
    this.undoButton.disabled = this.history.size === 0;
    show(this.status, notice('info', t('aiEdit.undone')));
  }
}

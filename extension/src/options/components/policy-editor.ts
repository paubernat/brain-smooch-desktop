// Form for a policy: instructions, the three option descriptions, fixed-rule
// switches, auxiliary questions and (optionally) the channel board. Shared by
// the manual mode and the wizard.
import { button, field, h, textarea } from '../dom';
import { t } from '../i18n';
import { formToPolicy, policyToForm, RULE_SWITCHES, slugifyAuxId, type AuxRow, type PolicyForm } from '../policy-form';
import type { PolicyContent } from '../types';
import { ChannelBoard } from './channel-board';
import { TIER_INFO, tierBlurb, tierHeader } from './tier';

export { TIER_INFO, tierBlurb, tierHeader } from './tier';

export interface EditorOptions {
  showChannels: boolean;
  onChange?: (policy: PolicyContent) => void;
}

export class PolicyEditor {
  readonly element = h('div', { className: 'policy-editor' });
  private form: PolicyForm;
  private readonly auxList = h('div', { className: 'aux-list' });

  constructor(policy: PolicyContent, private readonly options: EditorOptions) {
    this.form = policyToForm(policy);
    this.render();
  }

  getForm(): PolicyForm {
    return this.form;
  }

  getPolicy(): PolicyContent {
    return formToPolicy(this.form);
  }

  setPolicy(policy: PolicyContent): void {
    this.form = policyToForm(policy);
    this.render();
  }

  private changed(): void {
    this.options.onChange?.(this.getPolicy());
  }

  private render(): void {
    const f = this.form;
    const instructions = textarea(f.instructions, t('editor.instructionsPlaceholder'), 3, (v) => {
      f.instructions = v;
      this.changed();
    });
    const tiers = h(
      'div',
      { className: 'tier-grid' },
      ...TIER_INFO.map(({ label }) =>
        h(
          'section',
          { className: `tier-card tier-${label}` },
          tierHeader(label, tierBlurb(label)),
          textarea(f.options[label], t('editor.tierPlaceholder', { label }), 8, (v) => {
            f.options[label] = v;
            this.changed();
          }),
        ),
      ),
    );
    this.renderAux();
    const aux = h(
      'section',
      { className: 'subsection' },
      h('h3', { text: t('editor.aux') }),
      h('p', { className: 'muted', text: t('editor.auxLead') }),
      this.auxList,
      button(t('editor.auxAdd'), () => {
        f.aux.push({ id: '', instructions: '' });
        this.renderAux();
      }, 'ghost'),
    );
    this.element.replaceChildren(field(t('editor.instructions'), instructions, t('editor.instructionsHint')), tiers, this.renderRules(), aux);
    if (this.options.showChannels) this.element.append(this.renderChannels());
  }

  private renderRules(): HTMLElement {
    const switches = RULE_SWITCHES.map(({ key, title, note }) => {
      const input = h('input', { attrs: { type: 'checkbox', role: 'switch' } });
      input.checked = this.form.rules[key];
      input.addEventListener('change', () => {
        this.form.rules[key] = input.checked;
        this.changed();
      });
      return h(
        'label',
        { className: 'rule-switch' },
        input,
        h('span', { className: 'rule-text' }, h('strong', { text: t(title) }), h('span', { className: 'hint', text: t(note) })),
      );
    });
    return h(
      'section',
      { className: 'subsection rules' },
      h('h3', { text: t('editor.rules') }),
      h('p', { className: 'muted', text: t('editor.rulesLead') }),
      ...switches,
    );
  }

  private renderAux(): void {
    this.auxList.replaceChildren(...this.form.aux.map((row, i) => this.auxRow(row, i)));
  }

  private auxRow(row: AuxRow, index: number): HTMLElement {
    const id = h('input', { className: 'mono', attrs: { type: 'text', placeholder: 'is_gaming', 'aria-label': t('editor.auxId') } });
    id.value = row.id;
    id.addEventListener('input', () => {
      row.id = id.value;
      this.changed();
    });
    const question = h('input', { attrs: { type: 'text', placeholder: t('editor.auxQuestionPlaceholder'), 'aria-label': t('editor.auxQuestion') } });
    question.value = row.instructions;
    question.addEventListener('input', () => {
      row.instructions = question.value;
      this.changed();
    });
    question.addEventListener('blur', () => {
      if (!row.id.trim() && row.instructions.trim()) {
        row.id = slugifyAuxId(row.instructions);
        id.value = row.id;
        this.changed();
      }
    });
    const remove = button('✕', () => {
      this.form.aux.splice(index, 1);
      this.renderAux();
      this.changed();
    }, 'ghost');
    remove.title = t('editor.auxRemove');
    return h('div', { className: 'aux-row' }, id, question, remove);
  }

  private renderChannels(): HTMLElement {
    const board = new ChannelBoard(this.form.channels, (lists) => {
      this.form.channels = lists;
      this.changed();
    });
    return h(
      'section',
      { className: 'subsection' },
      h('h3', { text: t('editor.channels') }),
      h('p', { className: 'muted', text: t('editor.channelsLead') }),
      board.element,
    );
  }
}

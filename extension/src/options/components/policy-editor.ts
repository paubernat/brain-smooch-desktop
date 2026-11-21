// Form for a policy: instructions, the three option descriptions, fixed-rule
// switches, auxiliary questions and (optionally) channel lists. Shared by the
// manual mode and the wizard.
import type { Label } from '../../types';
import { button, field, h, textarea } from '../dom';
import { formToPolicy, policyToForm, RULE_SWITCHES, slugifyAuxId, type AuxRow, type PolicyForm } from '../policy-form';
import type { PolicyContent } from '../types';

export const TIER_INFO: readonly { label: Label; blurb: string }[] = [
  { label: 'LIBRE', blurb: 'Sin límite' },
  { label: 'LIMITADO', blurb: 'Con cupo de tiempo' },
  { label: 'NO', blurb: 'Bloqueado' },
];

export interface EditorOptions {
  showChannels: boolean;
  onChange?: (policy: PolicyContent) => void;
}

export function tierHeader(label: Label, blurb: string): HTMLElement {
  return h('header', {}, h('span', { className: `tier-badge tier-${label}`, text: label }), h('span', { className: 'muted', text: blurb }));
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
    const instructions = textarea(f.instructions, 'Para qué usas YouTube y cómo decidir…', 3, (v) => {
      f.instructions = v;
      this.changed();
    });
    const tiers = h(
      'div',
      { className: 'tier-grid' },
      ...TIER_INFO.map(({ label, blurb }) =>
        h(
          'section',
          { className: `tier-card tier-${label}` },
          tierHeader(label, blurb),
          textarea(f.options[label], `Qué va en ${label}…`, 8, (v) => {
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
      h('h3', { text: 'Preguntas auxiliares' }),
      h('p', { className: 'muted', text: 'Preguntas de sí/no que el juez responde junto al veredicto. No deciden nada: sirven para entender los errores.' }),
      this.auxList,
      button('+ Añadir pregunta', () => {
        f.aux.push({ id: '', instructions: '' });
        this.renderAux();
      }, 'ghost'),
    );
    this.element.replaceChildren(field('Instrucciones generales', instructions, 'Lo primero que lee el juez: 2–4 frases.'), tiers, this.renderRules(), aux);
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
        h('span', { className: 'rule-text' }, h('strong', { text: title }), h('span', { className: 'hint', text: note })),
      );
    });
    return h(
      'section',
      { className: 'subsection rules' },
      h('h3', { text: 'Reglas fijas' }),
      h('p', { className: 'muted', text: 'Dan NO directamente, antes de preguntar al modelo (no participan en la ablación).' }),
      ...switches,
    );
  }

  private renderAux(): void {
    this.auxList.replaceChildren(...this.form.aux.map((row, i) => this.auxRow(row, i)));
  }

  private auxRow(row: AuxRow, index: number): HTMLElement {
    const id = h('input', { className: 'mono', attrs: { type: 'text', placeholder: 'is_gaming', 'aria-label': 'Identificador' } });
    id.value = row.id;
    id.addEventListener('input', () => {
      row.id = id.value;
      this.changed();
    });
    const question = h('input', { attrs: { type: 'text', placeholder: '¿Trata principalmente sobre videojuegos?', 'aria-label': 'Pregunta' } });
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
    remove.title = 'Quitar pregunta';
    return h('div', { className: 'aux-row' }, id, question, remove);
  }

  private renderChannels(): HTMLElement {
    return h(
      'section',
      { className: 'subsection' },
      h('h3', { text: 'Listas de canales' }),
      h('p', { className: 'muted', text: 'Reglas fijas que se aplican antes del modelo (no participan en la ablación). Nombres separados por comas o saltos de línea.' }),
      h(
        'div',
        { className: 'tier-grid' },
        ...TIER_INFO.map(({ label, blurb }) =>
          h(
            'section',
            { className: `tier-card compact tier-${label}` },
            tierHeader(label, blurb),
            textarea(this.form.channels[label], 'Canal 1, Canal 2…', 3, (v) => {
              this.form.channels[label] = v;
              this.changed();
            }),
          ),
        ),
      ),
    );
  }
}

// Manual mode: edit the policy by hand (form or raw YAML) and save it.
import { optionsApi } from '../api';
import { viewHeader } from '../components/header';
import { PolicyEditor } from '../components/policy-editor';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { plural, shortDate } from '../format';
import { validateForm } from '../policy-form';
import type { PolicyOut } from '../types';

export function renderManual(): HTMLElement {
  const body = h('div', {}, spinner('Cargando la política…'));
  const root = h(
    'div',
    { className: 'view manual' },
    viewHeader('Configuración manual', 'Edita la política que lee el juez. Al guardar se crea una versión nueva y la anterior queda en policy/history/.'),
    body,
  );
  void load(body);
  return root;
}

async function load(body: HTMLElement): Promise<void> {
  const res = await optionsApi.getPolicy();
  if (!res.ok) {
    show(body, errorNotice(res.error, res.status, 'No se pudo leer la política'), button('Reintentar', () => {
      show(body, spinner('Cargando la política…'));
      void load(body);
    }));
    return;
  }
  new ManualEditor(body, res.data);
}

class ManualEditor {
  private policy: PolicyOut;
  private readonly editor: PolicyEditor;
  private readonly yamlArea = h('textarea', { className: 'mono yaml', attrs: { rows: '28', spellcheck: 'false', 'aria-label': 'YAML de la política' } });
  private readonly yamlToggle = h('input', { attrs: { type: 'checkbox' } });
  private readonly formPane = h('div');
  private readonly yamlPane = h('div', { className: 'hidden' });
  private readonly status = h('div', { className: 'status-slot' });
  private readonly meta = h('p', { className: 'muted small' });

  constructor(body: HTMLElement, policy: PolicyOut) {
    this.policy = policy;
    this.editor = new PolicyEditor(policy.content, { showChannels: true });
    this.yamlArea.value = policy.yaml;
    this.yamlToggle.addEventListener('change', () => this.toggleYaml());
    this.formPane.append(this.editor.element);
    this.yamlPane.append(
      notice('info', 'Modo avanzado: se guarda el YAML tal cual (el servicio lo valida). Los cambios sin guardar del formulario no aparecen aquí, y viceversa.'),
      this.yamlArea,
    );
    const save = button('Guardar política', () => void withBusy(save, 'Guardando…', () => this.save()), 'primary');
    const toolbar = h(
      'div',
      { className: 'toolbar' },
      h('label', { className: 'switch' }, this.yamlToggle, h('span', { text: 'YAML avanzado' })),
      this.meta,
    );
    body.replaceChildren(toolbar, this.formPane, this.yamlPane, h('div', { className: 'actions sticky' }, this.status, save));
    void this.renderMeta();
  }

  private toggleYaml(): void {
    const yaml = this.yamlToggle.checked;
    this.formPane.classList.toggle('hidden', yaml);
    this.yamlPane.classList.toggle('hidden', !yaml);
  }

  private async save(): Promise<void> {
    const yamlMode = this.yamlToggle.checked;
    if (!yamlMode) {
      const problems = validateForm(this.editor.getForm());
      if (problems.length) {
        show(this.status, notice('warn', h('strong', { text: 'Revisa el formulario:' }), h('ul', {}, ...problems.map((p) => h('li', { text: p })))));
        return;
      }
    }
    const res = await optionsApi.savePolicy(yamlMode ? { yaml: this.yamlArea.value } : { content: this.editor.getPolicy() }, this.policy.version);
    if (!res.ok) {
      show(this.status, errorNotice(res.error, res.status, 'No se pudo guardar'));
      return;
    }
    this.policy = res.data;
    this.editor.setPolicy(res.data.content);
    this.yamlArea.value = res.data.yaml;
    show(this.status, notice('ok', `Guardada como versión ${res.data.version}.`));
    void this.renderMeta();
  }

  private async renderMeta(): Promise<void> {
    const base = `Versión ${this.policy.version} · ${this.policy.policy_version}`;
    this.meta.textContent = base;
    const res = await optionsApi.history();
    if (res.ok && res.data.length) {
      const last = res.data[0];
      const when = last ? ` (última archivada: v${last.version}, ${shortDate(last.saved_at)})` : '';
      this.meta.textContent = `${base} · ${plural(res.data.length, 'versión anterior', 'versiones anteriores')}${when}`;
    }
  }
}

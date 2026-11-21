// Manual mode: edit the policy by hand (form or raw YAML) and save it. The
// craftsman statue lights up as sections are completed and fully on save.
import { optionsApi } from '../api';
import { AiEditBox } from '../components/ai-edit';
import { viewHeader } from '../components/header';
import { PolicyEditor } from '../components/policy-editor';
import { devOnlyNote, memorySession, mountTester, type PolicyTester } from '../components/policy-tester';
import { Statue } from '../components/statue';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { shortDate } from '../format';
import { t, tn } from '../i18n';
import { validateForm } from '../policy-form';
import { manualLight, manualMilestonesOf, raiseLight } from '../progress';
import { hrefFor } from '../router';
import { loadSetup, markPolicySaved, raiseStatue } from '../setup-state';
import { initialTuneState, type TuneState } from '../tune-state';
import type { PolicyContent, PolicyOut } from '../types';

export function renderManual(): HTMLElement {
  const body = h('div', {}, spinner(t('common.loadingPolicy')));
  const statue = new Statue('craftsman', 0, 'small');
  const root = h('div', { className: 'view manual' }, viewHeader(t('manual.title'), t('manual.lead'), '01', statue.element), body);
  void load(body, statue);
  return root;
}

async function load(body: HTMLElement, statue: Statue): Promise<void> {
  const [res, setup] = await Promise.all([optionsApi.getPolicy(), loadSetup()]);
  statue.setLight(setup.light.manual, false);
  if (!res.ok) {
    show(body, errorNotice(res.error, res.status, t('common.cannotReadPolicy')), button(t('common.retry'), () => {
      show(body, spinner(t('common.loadingPolicy')));
      void load(body, statue);
    }));
    return;
  }
  new ManualEditor(body, res.data, statue, setup.light.manual);
}

class ManualEditor {
  private policy: PolicyOut;
  private readonly editor: PolicyEditor;
  private readonly yamlArea = h('textarea', { className: 'mono yaml', attrs: { rows: '28', spellcheck: 'false', 'aria-label': t('manual.yamlLabel') } });
  private readonly yamlToggle = h('input', { attrs: { type: 'checkbox' } });
  private readonly formPane = h('div');
  private readonly yamlPane = h('div', { className: 'hidden' });
  private readonly status = h('div', { className: 'status-slot' });
  private readonly meta = h('p', { className: 'muted small mono' });
  private readonly aiEdit: AiEditBox;
  private readonly testerPane = h('section', { className: 'tester-pane hidden' });
  private readonly testerTrigger = button(t('manual.test'), () => this.toggleTester());
  private tester: PolicyTester<TuneState> | null = null;

  constructor(body: HTMLElement, policy: PolicyOut, private readonly statue: Statue, private light: number) {
    this.policy = policy;
    this.editor = new PolicyEditor(policy.content, {
      showChannels: true,
      onChange: (p) => {
        this.tester?.setDraft(p);
        this.progress(p);
      },
    });
    this.yamlArea.value = policy.yaml;
    this.yamlToggle.addEventListener('change', () => this.toggleYaml());
    this.aiEdit = new AiEditBox({
      getPolicy: () => this.editor.getPolicy(),
      setPolicy: (p) => {
        this.editor.setPolicy(p);
        this.tester?.setDraft(p);
        this.progress(p);
      },
    });
    this.formPane.append(this.aiEdit.element, this.testerPane, this.editor.element);
    this.yamlPane.append(notice('info', t('manual.yamlNotice')), this.yamlArea);
    const save = button(t('manual.save'), () => void withBusy(save, t('common.saving'), () => this.save()), 'primary');
    const toolbar = h(
      'div',
      { className: 'toolbar' },
      h('div', { className: 'toolbar-group' }, h('label', { className: 'switch' }, this.yamlToggle, h('span', { text: t('manual.yamlToggle') })), this.aiEdit.trigger, this.testerTrigger),
      this.meta,
    );
    body.replaceChildren(toolbar, this.formPane, this.yamlPane, h('div', { className: 'actions sticky' }, this.status, save));
    this.progress(policy.content);
    void this.renderMeta();
  }

  /** Light the craftsman for the sections completed so far (never dims). */
  private progress(policy: PolicyContent): void {
    const next = raiseLight(this.light, manualLight({ ...manualMilestonesOf(policy), saved: false }));
    if (next === this.light) return;
    this.light = next;
    this.statue.setLight(next);
    void raiseStatue('manual', next);
  }

  private toggleYaml(): void {
    const yaml = this.yamlToggle.checked;
    this.formPane.classList.toggle('hidden', yaml);
    this.yamlPane.classList.toggle('hidden', !yaml);
    this.aiEdit.trigger.classList.toggle('hidden', yaml); // the AI edits the form, not the raw YAML
    this.testerTrigger.classList.toggle('hidden', yaml);
  }

  /** "Probar política" on the form as it is now (unsaved edits included). */
  private toggleTester(): void {
    const open = this.testerPane.classList.toggle('hidden') === false;
    if (!open || this.tester) return;
    const slot = h('div');
    this.testerPane.replaceChildren(h('h3', { text: t('test.title') }), notice('info', devOnlyNote()), slot);
    const session = memorySession(initialTuneState(this.editor.getPolicy()));
    void mountTester(slot, session, { showEditor: false, onAccept: (p) => this.editor.setPolicy(p) }).then((tester) => {
      this.tester = tester;
    });
  }

  private async save(): Promise<void> {
    const yamlMode = this.yamlToggle.checked;
    if (!yamlMode) {
      const problems = validateForm(this.editor.getForm());
      if (problems.length) {
        show(this.status, notice('warn', h('strong', { text: t('manual.reviewForm') }), h('ul', {}, ...problems.map((p) => h('li', { text: p })))));
        return;
      }
    }
    const res = await optionsApi.savePolicy(yamlMode ? { yaml: this.yamlArea.value } : { content: this.editor.getPolicy() }, this.policy.version);
    if (!res.ok) {
      show(this.status, errorNotice(res.error, res.status, t('common.cannotSave')));
      return;
    }
    this.policy = res.data;
    this.editor.setPolicy(res.data.content);
    this.yamlArea.value = res.data.yaml;
    this.light = 1;
    this.statue.setLight(1);
    await markPolicySaved('manual');
    show(
      this.status,
      notice('ok', h('strong', { text: t('common.savedVersion', { version: res.data.version }) }), h('a', { className: 'btn secondary', text: t('common.next'), attrs: { href: hrefFor('sites') } })),
    );
    void this.renderMeta();
  }

  private async renderMeta(): Promise<void> {
    const base = t('manual.meta', { version: this.policy.version, policyVersion: this.policy.policy_version });
    this.meta.textContent = base;
    const res = await optionsApi.history();
    if (res.ok && res.data.length) {
      const last = res.data[0];
      const when = last ? t('manual.metaArchived', { version: last.version, date: shortDate(last.saved_at) }) : '';
      this.meta.textContent = `${base} · ${tn(res.data.length, 'manual.previous')}${when}`;
    }
  }
}

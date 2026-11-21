// "Probar política" (#probar): evaluate the saved policy on the dev split,
// tweak it or accept a Claude proposal, and save the result.
import { optionsApi } from '../api';
import { viewHeader } from '../components/header';
import { devOnlyNote, memorySession, mountTester } from '../components/policy-tester';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { t } from '../i18n';
import { markPolicySaved } from '../setup-state';
import { initialTuneState } from '../tune-state';
import type { PolicyOut } from '../types';

export function renderTestPolicy(): HTMLElement {
  const body = h('div', {}, spinner(t('common.loadingPolicy')));
  void load(body);
  return h('div', { className: 'view test-policy' }, viewHeader(t('test.title'), t('test.lead'), '🧪'), notice('info', devOnlyNote()), body);
}

async function load(body: HTMLElement): Promise<void> {
  const res = await optionsApi.getPolicy();
  if (!res.ok) {
    show(body, errorNotice(res.error, res.status, t('common.cannotReadPolicy')));
    return;
  }
  let policy: PolicyOut = res.data;
  const session = memorySession(initialTuneState(policy.content));
  const testerSlot = h('div');
  const status = h('div', { className: 'status-slot' });
  const save = button(t('test.save'), () => void withBusy(save, t('common.saving'), async () => {
    const draft = session.state.draft;
    if (!draft) return;
    const saved = await optionsApi.savePolicy({ content: draft }, policy.version);
    if (!saved.ok) {
      show(status, errorNotice(saved.error, saved.status, t('common.cannotSave')));
      return;
    }
    policy = saved.data;
    await markPolicySaved();
    show(status, notice('ok', t('common.savedVersion', { version: saved.data.version })));
  }), 'primary');
  body.replaceChildren(testerSlot, h('div', { className: 'actions sticky' }, status, save));
  void mountTester(testerSlot, session, { showEditor: true });
}

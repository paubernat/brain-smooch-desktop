// "Probar política" (#probar): evaluate the saved policy on the dev split,
// tweak it or accept a Claude proposal, and save the result.
import { optionsApi } from '../api';
import { viewHeader } from '../components/header';
import { DEV_ONLY_NOTE, memorySession, mountTester } from '../components/policy-tester';
import { errorNotice, notice, show, spinner } from '../components/status';
import { button, h, withBusy } from '../dom';
import { initialTuneState } from '../tune-state';
import type { PolicyOut } from '../types';

export function renderTestPolicy(): HTMLElement {
  const body = h('div', {}, spinner('Cargando la política…'));
  void load(body);
  return h(
    'div',
    { className: 'view test-policy' },
    viewHeader('Probar política', 'Evalúa la política guardada con un juez sobre tus etiquetas, mira los errores y pide a la IA una versión mejor.'),
    notice('info', DEV_ONLY_NOTE),
    body,
  );
}

async function load(body: HTMLElement): Promise<void> {
  const res = await optionsApi.getPolicy();
  if (!res.ok) {
    show(body, errorNotice(res.error, res.status, 'No se pudo leer la política'));
    return;
  }
  let policy: PolicyOut = res.data;
  const session = memorySession(initialTuneState(policy.content));
  const testerSlot = h('div');
  const status = h('div', { className: 'status-slot' });
  const save = button('Guardar esta versión', () => void withBusy(save, 'Guardando…', async () => {
    const draft = session.state.draft;
    if (!draft) return;
    const saved = await optionsApi.savePolicy({ content: draft }, policy.version);
    if (!saved.ok) {
      show(status, errorNotice(saved.error, saved.status, 'No se pudo guardar'));
      return;
    }
    policy = saved.data;
    show(status, notice('ok', `Guardada como versión ${saved.data.version}.`));
  }), 'primary');
  body.replaceChildren(testerSlot, h('div', { className: 'actions sticky' }, status, save));
  void mountTester(testerSlot, session, { showEditor: true });
}

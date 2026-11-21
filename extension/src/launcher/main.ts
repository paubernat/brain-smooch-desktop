// Options page of the extension: a thin launcher. The onboarding and the
// dashboard live on the local web served by the service
// (http://127.0.0.1:8765/), which keeps working even if the extension breaks.
// If the service answers, the tab goes straight there (keeping the #section);
// otherwise it explains how to start it.
import { corners } from '../options/components/frame';
import { START_COMMAND } from '../options/components/status';
import { button, h } from '../options/dom';
import { currentLang, initLang, t } from '../options/i18n';
import { SETUP_IMPORT_PARAM } from '../options/setup-state';
import { storageGet } from '../platform/storage';
import { fetchService, localWebUrl } from '../service-http';

async function render(app: HTMLElement): Promise<void> {
  const section = location.hash.replace(/^#/, '');
  const url = await localWebUrl(section);
  const health = await fetchService<{ status: string }>('GET', '/health', undefined, 3000);
  if (health.ok) {
    // Hand the old onboarding progress of this Firefox profile to the web (once).
    const setup = await storageGet('setupState');
    const target = new URL(url);
    if (setup !== undefined) target.searchParams.set(SETUP_IMPORT_PARAM, JSON.stringify(setup));
    location.replace(target.toString());
    return;
  }
  const open = h('a', { className: 'btn primary', text: t('launcher.open'), attrs: { href: url } });
  app.replaceChildren(
    h(
      'section',
      { className: 'blocked-card view-enter' },
      ...corners(),
      h('p', { className: 'eyebrow mono', text: t('launcher.eyebrow') }),
      h('h1', { className: 'display', text: t('launcher.title') }),
      h('p', { className: 'lead', text: t('launcher.down') }),
      h('code', { className: 'command', text: START_COMMAND }),
      h('div', { className: 'actions inline' }, open, button(t('common.retry'), () => void render(app))),
    ),
  );
}

async function start(): Promise<void> {
  await initLang();
  document.documentElement.lang = currentLang();
  document.title = t('launcher.title');
  const app = document.getElementById('app');
  if (app) await render(app);
}

void start();

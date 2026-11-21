// Launch sequence: a full-screen overlay where the rocket ignites and lifts
// off with neon exhaust, then the screen wipes to the dashboard. With
// prefers-reduced-motion it resolves at once.
import { rocketSvg } from '../art/statues';
import { button, h } from '../dom';
import { t } from '../i18n';
import { corners } from './frame';

const IGNITION_MS = 700;
const LIFTOFF_MS = 1500;

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function playLaunch(): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  return new Promise((resolve) => {
    const label = h('p', { className: 'launch-label mono', text: t('launch.countdown') });
    const rocket = rocketSvg();
    rocket.classList.add('lit-all');
    const overlay = h(
      'div',
      { className: 'launch-overlay', attrs: { role: 'status', 'aria-live': 'polite' } },
      ...corners(),
      h('div', { className: 'launch-stage' }, rocket),
      label,
    );
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      overlay.classList.add('wipe');
      setTimeout(() => {
        overlay.remove();
        resolve();
      }, 450);
    };
    overlay.append(button(t('launch.skip'), finish, 'ghost'));
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.classList.add('ignite'));
    setTimeout(() => {
      label.textContent = t('launch.liftoff');
      overlay.classList.add('liftoff');
    }, IGNITION_MS);
    setTimeout(finish, IGNITION_MS + LIFTOFF_MS);
  });
}

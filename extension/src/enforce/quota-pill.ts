// Small always-visible pill on LIMITADO videos with the quota countdown
// ("LIMITADO · 12:34 left"). Closed Shadow DOM, neon style; it does not take
// clicks, so it never gets in the way of the player.
import { t } from '../options/i18n';
import { formatCountdown } from './quota-countdown';

const CSS = `
:host { all: initial; }
.pill {
  position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 2147483645;
  pointer-events: none; padding: 6px 14px; border: 1px solid #ff7a1a; border-radius: 999px;
  background: rgb(5 6 7 / 88%); color: #ffb27a; box-shadow: 0 0 14px rgb(255 122 26 / 35%);
  font: 600 13px/1.2 "Cascadia Mono", Consolas, monospace; letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.pill.low { border-color: #ff3d5e; color: #ff8fa3; box-shadow: 0 0 14px rgb(255 61 94 / 45%); }
`;
const LOW_S = 60;

export class QuotaPill {
  private readonly host = document.createElement('div');
  private readonly pill = document.createElement('div');

  constructor() {
    this.host.id = 'brain-smooch-quota';
    const root = this.host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.pill.className = 'pill';
    this.pill.setAttribute('role', 'timer');
    this.pill.setAttribute('aria-live', 'off');
    root.append(style, this.pill);
  }

  /** Seconds left (null hides the pill). */
  render(seconds: number | null, grace: boolean): void {
    if (seconds === null) {
      this.host.remove();
      return;
    }
    if (!this.host.isConnected) document.documentElement.append(this.host);
    const time = formatCountdown(seconds);
    this.pill.textContent = grace ? t('quota.pillGrace', { time }) : t('quota.pill', { time });
    this.pill.classList.toggle('low', seconds <= LOW_S);
  }
}

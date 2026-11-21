// Full-page overlay of the gate on YouTube ("Deciding…" / blocked screens),
// isolated in a closed Shadow DOM, neon style like the local web. It sits just
// below the label panel, which stays usable. No innerHTML.
import { t } from '../options/i18n';
import type { Label } from '../types';
import type { OverlayAction, OverlayModel } from './overlay-model';

export interface OverlayHandlers {
  onRetry: () => void;
  onDashboard: () => void;
  /** "Mark as error": what it should have been and why (stays blocked). */
  onDispute: (label: Exclude<Label, 'NO'>, reason: string) => Promise<boolean>;
}

const CSS = `
:host { all: initial; }
.veil {
  position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 24px;
  font: 15px/1.55 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; color: #e8f1ec;
  background:
    radial-gradient(900px 500px at 10% -10%, rgb(57 255 139 / 10%), transparent 60%),
    radial-gradient(800px 500px at 110% 110%, rgb(255 122 26 / 10%), transparent 60%),
    rgb(5 6 7 / 97%);
}
.veil * { box-sizing: border-box; }
.card { --c: #39ff8b; position: relative; width: min(680px, 100%); padding: 36px 40px; border: 1px solid rgb(150 255 200 / 18%); background: rgb(11 14 16 / 92%); }
.card.no { --c: #ff3d5e; } .card.limit { --c: #ff7a1a; } .card.error { --c: #ff7a1a; }
.card::before, .card::after { content: ""; position: absolute; width: 14px; height: 14px; border: 2px solid var(--c); }
.card::before { top: -1px; left: -1px; border-right: 0; border-bottom: 0; }
.card::after { bottom: -1px; right: -1px; border-left: 0; border-top: 0; }
.eyebrow { margin: 0 0 10px; font: 600 12px/1 "Cascadia Mono", Consolas, monospace; letter-spacing: 0.2em; text-transform: uppercase; color: var(--c); }
h1 { margin: 0 0 12px; font: 700 44px/1 "Bahnschrift", "Arial Narrow", Impact, sans-serif; text-transform: uppercase; letter-spacing: 0.02em; color: var(--c); text-shadow: 0 0 18px color-mix(in srgb, var(--c) 45%, transparent); }
.lead { margin: 0 0 8px; font-size: 17px; }
.detail { margin: 0 0 8px; color: #8b978f; font-size: 14px; overflow-wrap: anywhere; }
code { display: inline-block; margin: 6px 0 10px; padding: 6px 10px; background: #10151a; border: 1px solid rgb(150 255 200 / 18%); font: 13px "Cascadia Mono", Consolas, monospace; }
.meter { height: 8px; margin: 14px 0 6px; background: #151b20; border: 1px solid rgb(150 255 200 / 12%); }
.meter span { display: block; height: 100%; background: var(--c); box-shadow: 0 0 10px var(--c); }
.spinner { width: 34px; height: 34px; margin: 0 0 18px; border: 3px solid rgb(57 255 139 / 20%); border-top-color: #39ff8b; border-radius: 50%; animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
button, input { font: inherit; }
button { cursor: pointer; padding: 9px 16px; color: #e8f1ec; background: #10151a; border: 1px solid rgb(150 255 200 / 28%); }
button:hover { border-color: var(--c); color: var(--c); }
button.primary { background: var(--c); border-color: var(--c); color: #03120a; }
button:disabled { opacity: 0.5; cursor: default; }
.dispute { margin-top: 16px; padding-top: 14px; border-top: 1px solid rgb(150 255 200 / 12%); }
.dispute p { margin: 0 0 8px; }
.dispute input { width: 100%; margin: 0 0 10px; padding: 8px 10px; color: #e8f1ec; background: #10151a; border: 1px solid rgb(150 255 200 / 28%); }
.dispute .status { color: #8b978f; font-size: 13px; min-height: 1.4em; }
.dispute .status.ok { color: #39ff8b; } .dispute .status.error { color: #ff3d5e; }
.hidden { display: none !important; }
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function btn(text: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export class GateOverlay {
  private readonly host = el('div');
  private readonly root: ShadowRoot;
  private readonly veil = el('div', 'veil');
  private shownKey = '';

  constructor(private readonly handlers: OverlayHandlers) {
    this.host.id = 'brain-smooch-gate';
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = CSS;
    this.root.append(style, this.veil);
    // Keys typed in the overlay must not reach YouTube's shortcuts (k, space...).
    this.veil.addEventListener('keydown', (e) => e.stopPropagation());
  }

  /** `key` identifies the screen: the same screen is not rebuilt (keeps the dispute form). */
  render(model: OverlayModel | null, key: string): void {
    if (!model) {
      this.host.remove();
      this.shownKey = '';
      return;
    }
    if (!this.host.isConnected) document.documentElement.append(this.host);
    if (key === this.shownKey) return;
    this.shownKey = key;
    this.veil.replaceChildren(this.card(model));
  }

  private card(model: OverlayModel): HTMLElement {
    const card = el('section', `card ${model.tone}`);
    card.setAttribute('role', model.tone === 'deciding' ? 'status' : 'alert');
    if (model.tone === 'deciding') card.append(el('div', 'spinner'));
    card.append(el('p', 'eyebrow', model.eyebrow), el('h1', '', model.title), el('p', 'lead', model.lead));
    if (model.meter !== null) {
      const meter = el('div', 'meter');
      const fill = el('span');
      fill.style.width = `${Math.round(model.meter * 100)}%`;
      meter.append(fill);
      card.append(meter);
    }
    if (model.detail) card.append(el('p', 'detail', model.detail));
    if (model.command) card.append(el('code', '', model.command));
    const dispute = model.actions.includes('dispute') ? this.disputeForm() : null;
    const actions = el('div', 'actions');
    for (const action of model.actions) actions.append(this.actionButton(action, dispute));
    card.append(actions);
    if (dispute) card.append(dispute);
    return card;
  }

  private actionButton(action: OverlayAction, dispute: HTMLElement | null): HTMLButtonElement {
    switch (action) {
      case 'retry':
        return btn(t('gate.action.retry'), () => this.handlers.onRetry(), 'primary');
      case 'back':
        return btn(t('gate.action.back'), () => history.back());
      case 'home':
        return btn(t('gate.action.home'), () => location.assign('/'));
      case 'dashboard':
        return btn(t('gate.action.dashboard'), () => this.handlers.onDashboard());
      case 'dispute':
        return btn(t('gate.action.dispute'), () => dispute?.classList.toggle('hidden'));
    }
  }

  private disputeForm(): HTMLElement {
    const box = el('div', 'dispute hidden');
    const reason = el('input');
    reason.placeholder = t('gate.dispute.reason');
    reason.maxLength = 500;
    const status = el('p', 'status');
    const choices = (['LIMITADO', 'LIBRE'] as const).map((label) =>
      btn(label, () => {
        choices.forEach((b) => (b.disabled = true));
        status.className = 'status';
        status.textContent = t('gate.dispute.saving');
        void this.handlers.onDispute(label, reason.value.trim()).then((ok) => {
          status.className = `status ${ok ? 'ok' : 'error'}`;
          status.textContent = ok ? t('gate.dispute.saved') : t('gate.dispute.failed');
          if (!ok) choices.forEach((b) => (b.disabled = false));
        });
      }),
    );
    const row = el('div', 'actions');
    row.append(...choices);
    box.append(el('p', '', t('gate.dispute.question')), reason, row, status);
    return box;
  }
}

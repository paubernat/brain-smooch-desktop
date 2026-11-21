// Floating label panel: NO / LIMITADO / LIBRE + optional reason + level
// status (L1..L4) + pending-feedback badge. Isolated from YouTube's CSS with a
// closed Shadow DOM. Shortcuts: Alt+1 / Alt+2 / Alt+3 (see shortcuts.ts).
//
// The label buttons are never `disabled`: a disabled button swallows clicks
// without any feedback. While the ficha is still being saved the panel is in
// a "waiting" state and the content script queues the label instead.
import { LABELS, type Label, type LabelInfo, type LevelStatus } from '../types';
import { PANEL_CSS } from './panel-styles';
import { SHORTCUTS, shortcutLabel } from './shortcuts';

export type StatusKind = 'info' | 'ok' | 'error';

export interface PanelHandlers {
  onLabel: (label: Label, reason: string) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onOpenCalibration: () => void;
}

/** Labels not yet incorporated into the policy (dev split only). */
export interface PendingFeedback {
  pending: number;
  threshold: number;
}

type LevelView = Partial<Record<keyof LevelStatus, string>>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

const LEVEL_CLASS: Record<string, string> = {
  ok: 'ok',
  pending: 'pending',
  none: 'bad',
  blocked: 'bad',
  error: 'bad',
};

/** Compact chip text: the head must fit in the panel whatever the states are. */
export function levelChip(key: keyof LevelStatus, value: string | undefined): string {
  if (!value) return `${key}·`;
  if (value === 'ok') return `${key}✓`;
  if (value === 'pending') return `${key}…`;
  return `${key}✗`;
}

export class LabelPanel {
  private readonly host = h('div');
  private readonly root: ShadowRoot;
  private readonly panel = h('div', 'panel hidden waiting');
  private readonly levelsEl = h('div', 'levels');
  private readonly badgeEl = h('button', 'badge hidden');
  private readonly currentEl = h('span', 'current');
  private readonly titleEl = h('div', 'title');
  private readonly reasonEl = h('input');
  private readonly statusEl = h('div', 'status');
  private readonly calibrationEl = h('button', 'link calibrate hidden');
  private readonly buttons = new Map<Label, HTMLButtonElement>();
  private videoId: string | null = null;
  private current: LabelInfo | null = null;

  constructor(private readonly handlers: PanelHandlers) {
    this.host.id = 'brain-smooch-desktop-panel';
    this.root = this.host.attachShadow({ mode: 'closed' });
    const style = h('style');
    style.textContent = PANEL_CSS;
    this.root.append(style, this.panel);
    this.build();
    window.addEventListener('keydown', (e) => this.onKey(e), true);
  }

  private build(): void {
    const head = h('div', 'head');
    head.title = 'Brain Smooch: clic para plegar / desplegar';
    const settings = h('button', 'icon', '⚙');
    settings.type = 'button';
    settings.title = 'Configura tu perfil';
    settings.addEventListener('click', (e) => {
      e.stopPropagation(); // don't collapse the panel
      this.handlers.onOpenSettings();
    });
    this.badgeEl.type = 'button';
    this.badgeEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handlers.onOpenCalibration();
    });
    head.append(h('span', 'brand', 'BSD'), this.levelsEl, this.badgeEl, this.currentEl, settings);
    head.addEventListener('click', () => this.panel.classList.toggle('collapsed'));

    const row = h('div', 'buttons');
    for (const label of LABELS) {
      const b = h('button', `label ${label}`, label);
      b.type = 'button';
      b.title = `${label} (${SHORTCUTS[label]})`;
      b.setAttribute('aria-keyshortcuts', SHORTCUTS[label]);
      b.addEventListener('click', () => this.submit(label));
      this.buttons.set(label, b);
      row.append(b);
    }
    this.reasonEl.placeholder = 'motivo (opcional)';
    this.reasonEl.maxLength = 500;
    this.reasonEl.addEventListener('keydown', (e) => e.stopPropagation()); // don't trigger YouTube shortcuts
    this.calibrationEl.type = 'button';
    this.calibrationEl.addEventListener('click', () => this.handlers.onOpenCalibration());
    const hint = h('div', 'hint', LABELS.map((l) => `${SHORTCUTS[l]} ${l}`).join(' · '));
    const body = h('div', 'body');
    body.append(this.titleEl, row, this.reasonEl, this.statusEl, this.calibrationEl, hint);
    this.panel.append(head, body);
    this.setLevels({});
  }

  mount(): void {
    if (!this.host.isConnected) document.documentElement.append(this.host);
  }

  hide(): void {
    this.panel.classList.add('hidden');
    this.videoId = null;
  }

  setVideo(videoId: string, title: string): void {
    if (this.videoId !== videoId) {
      this.reasonEl.value = '';
      this.current = null;
      this.renderLabel();
    }
    this.videoId = videoId;
    this.titleEl.textContent = title || videoId;
    this.titleEl.title = title;
    this.panel.classList.remove('hidden');
  }

  currentVideo(): string | null {
    return this.videoId;
  }

  /** Ready once the ficha exists in the service; before that, labels get queued. */
  setReady(ready: boolean): void {
    this.panel.classList.toggle('waiting', !ready);
  }

  setBusy(busy: boolean): void {
    this.panel.classList.toggle('busy', busy);
  }

  setLevels(levels: LevelView): void {
    this.levelsEl.replaceChildren();
    (['L1', 'L2', 'L3', 'L4'] as const).forEach((key) => {
      const value = levels[key];
      const el = h('span', `lvl ${value ? (LEVEL_CLASS[value] ?? '') : ''}`, levelChip(key, value));
      el.title = `${key}: ${value ?? 'desconocido'}`;
      this.levelsEl.append(el);
    });
  }

  setLabel(info: LabelInfo | null): void {
    this.current = info;
    if (info?.reason && !this.reasonEl.value) this.reasonEl.value = info.reason;
    this.renderLabel();
  }

  /** Badge with the pending count; a hint to refresh the policy past the threshold. */
  setPending(feedback: PendingFeedback | null): void {
    const pending = feedback?.pending ?? 0;
    this.badgeEl.classList.toggle('hidden', pending === 0);
    this.badgeEl.textContent = String(pending);
    this.badgeEl.title = `${pending} etiquetas pendientes de incorporar a la política (split dev)`;
    const hint = feedback !== null && pending >= feedback.threshold;
    this.calibrationEl.classList.toggle('hidden', !hint);
    this.calibrationEl.textContent = `Refresca tu política (${pending} pendientes)`;
  }

  setStatus(text: string, kind: StatusKind = 'info', retry = false): void {
    this.statusEl.className = `status ${kind === 'info' ? '' : kind}`;
    this.statusEl.replaceChildren(h('span', '', text));
    if (retry) {
      const b = h('button', 'link', 'reintentar');
      b.type = 'button';
      b.addEventListener('click', () => this.handlers.onRetry());
      this.statusEl.append(b);
    }
  }

  private renderLabel(): void {
    const label = this.current?.label ?? null;
    this.buttons.forEach((b, l) => b.classList.toggle('selected', l === label));
    this.currentEl.textContent = label ?? '';
    this.currentEl.className = `current ${label ? `${label}-text` : ''}`;
  }

  private submit(label: Label): void {
    if (!this.videoId) return;
    this.handlers.onLabel(label, this.reasonEl.value.trim());
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.videoId) return;
    const label = shortcutLabel(e);
    if (!label) return;
    e.preventDefault();
    e.stopPropagation();
    this.submit(label);
  }
}

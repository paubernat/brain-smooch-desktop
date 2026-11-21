// Floating label panel: NO / LIMITADO / LIBRE + optional reason + level
// status (L1..L4). Isolated from YouTube's CSS with a closed Shadow DOM.
// Shortcuts: Alt+1 / Alt+2 / Alt+3.
import { LABELS, type Label, type LabelInfo, type LevelStatus } from '../types';
import { PANEL_CSS } from './panel-styles';

export type StatusKind = 'info' | 'ok' | 'error';

export interface PanelHandlers {
  onLabel: (label: Label, reason: string) => void;
  onRetry: () => void;
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

export class LabelPanel {
  private readonly host = h('div');
  private readonly root: ShadowRoot;
  private readonly panel = h('div', 'panel hidden');
  private readonly levelsEl = h('div', 'levels');
  private readonly currentEl = h('span', 'current');
  private readonly titleEl = h('div', 'title');
  private readonly reasonEl = h('input');
  private readonly statusEl = h('div', 'status');
  private readonly buttons = new Map<Label, HTMLButtonElement>();
  private videoId: string | null = null;
  private current: LabelInfo | null = null;
  private enabled = false;

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
    head.title = 'Brain Smooch: click to collapse / expand';
    head.append(h('span', 'brand', 'BSD'), this.levelsEl, this.currentEl);
    head.addEventListener('click', () => this.panel.classList.toggle('collapsed'));

    const body = h('div', 'body');
    const row = h('div', 'buttons');
    LABELS.forEach((label, i) => {
      const b = h('button', label, label);
      b.title = `${label} (Alt+${i + 1})`;
      b.addEventListener('click', () => this.submit(label));
      this.buttons.set(label, b);
      row.append(b);
    });
    this.reasonEl.placeholder = 'motivo (opcional)';
    this.reasonEl.maxLength = 500;
    this.reasonEl.addEventListener('keydown', (e) => e.stopPropagation()); // don't trigger YouTube shortcuts
    body.append(this.titleEl, row, this.reasonEl, this.statusEl, h('div', 'hint', 'Alt+1 NO · Alt+2 LIMITADO · Alt+3 LIBRE'));
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

  /** Enable buttons only once the ficha exists in the service. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.buttons.forEach((b) => (b.disabled = !enabled));
  }

  setBusy(busy: boolean): void {
    this.panel.classList.toggle('busy', busy);
  }

  setLevels(levels: LevelView): void {
    this.levelsEl.replaceChildren();
    (['L1', 'L2', 'L3', 'L4'] as const).forEach((key) => {
      const value = levels[key];
      const text = value === 'ok' ? `${key}✓` : value ? `${key} ${value}` : `${key} ·`;
      const el = h('span', `lvl ${value ? (LEVEL_CLASS[value] ?? '') : ''}`, text);
      el.title = `${key}: ${value ?? 'unknown'}`;
      this.levelsEl.append(el);
    });
  }

  setLabel(info: LabelInfo | null): void {
    this.current = info;
    if (info?.reason && !this.reasonEl.value) this.reasonEl.value = info.reason;
    this.renderLabel();
  }

  setStatus(text: string, kind: StatusKind = 'info', retry = false): void {
    this.statusEl.className = `status ${kind === 'info' ? '' : kind}`;
    this.statusEl.replaceChildren(h('span', '', text));
    if (retry) {
      const b = h('button', 'link', 'reintentar');
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
    if (!this.videoId || !this.enabled) return;
    this.handlers.onLabel(label, this.reasonEl.value.trim());
  }

  private onKey(e: KeyboardEvent): void {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !this.videoId) return;
    const idx = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
    const label = LABELS[idx];
    if (!label) return;
    e.preventDefault();
    e.stopPropagation();
    this.submit(label);
  }
}

// Floating label panel: NO / LIMITADO / LIBRE + optional reason + level
// status (L1..L4) + pending-feedback badge + "IA" / "LIVE" badges for the
// current video, the live verdict of the model ("Modelo: LIBRE · 87 %") and a
// "📌 Canal → NO / LIMITADO / LIBRE" control that pins the video's channel,
// plus the daily quota meter while a LIMITADO video is counted.
// Isolated from YouTube's CSS with a
// closed Shadow DOM. Shortcuts: Alt+1 / Alt+2 / Alt+3 (see shortcuts.ts).
//
// The label buttons are never `disabled`: a disabled button swallows clicks
// without any feedback. While the ficha is still being saved the panel is in
// a "waiting" state and the content script queues the label instead.
import { t } from '../options/i18n';
import { LABELS, type Label, type LabelInfo, type LevelStatus, type Metadata } from '../types';
import { PANEL_CSS } from './panel-styles';
import { SHORTCUTS, shortcutLabel } from './shortcuts';
import { verdictDisplay, type VerdictState } from './verdict-view';

export type StatusKind = 'info' | 'ok' | 'error';

export interface PanelHandlers {
  onLabel: (label: Label, reason: string) => void;
  onRetry: () => void;
  onOpenSettings: () => void;
  onOpenCalibration: () => void;
  /** Pin the current channel to a list (the same tier again unpins it). */
  onChannelTier?: (label: Label) => void;
}

/** Labels not yet incorporated into the policy (both splits). */
export interface PendingFeedback {
  pending: number;
  threshold: number;
}

type LevelView = Partial<Record<keyof LevelStatus, string>>;

/** Small badge next to the title ("IA", "LIVE"). */
export interface SignalBadge {
  kind: 'ai' | 'live';
  text: string;
  title: string;
}

/** Badges for a video: creator-disclosed AI label, live now / scheduled. */
export function signalBadges(meta: Pick<Metadata, 'ai_disclosure' | 'live'>): SignalBadge[] {
  const badges: SignalBadge[] = [];
  if (meta.ai_disclosure.labeled) {
    const detail = meta.ai_disclosure.text ? `: ${meta.ai_disclosure.text}` : '';
    badges.push({ kind: 'ai', text: 'IA', title: `Etiqueta de YouTube (declarada por el creador)${detail}` });
  }
  if (meta.live.is_live_now) badges.push({ kind: 'live', text: 'LIVE', title: 'Directo en curso' });
  else if (meta.live.is_upcoming) badges.push({ kind: 'live', text: 'LIVE', title: 'Directo o estreno programado' });
  return badges;
}

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
  private readonly signalsEl = h('span', 'signals');
  private readonly reasonEl = h('input');
  private readonly statusEl = h('div', 'status');
  private readonly verdictEl = h('div', 'verdict hidden');
  private readonly quotaEl = h('div', 'quota hidden');
  private readonly calibrationEl = h('button', 'link calibrate hidden');
  private readonly buttons = new Map<Label, HTMLButtonElement>();
  private readonly channelEl = h('div', 'channel-row hidden');
  private readonly channelStateEl = h('span', 'channel-state');
  private readonly pinButtons = new Map<Label, HTMLButtonElement>();
  private channelName = '';
  private videoId: string | null = null;
  private current: LabelInfo | null = null;
  private verdict: VerdictState = { kind: 'idle' };

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
    const titleRow = h('div', 'title-row');
    titleRow.append(this.signalsEl, this.titleEl);
    body.append(titleRow, this.verdictEl, this.quotaEl, row, this.reasonEl, this.buildChannelRow(), this.statusEl, this.calibrationEl, hint);
    this.panel.append(head, body);
    this.setLevels({});
  }

  private buildChannelRow(): HTMLElement {
    const pins = h('span', 'pins');
    for (const label of LABELS) {
      const b = h('button', `pin ${label}`, label === 'LIMITADO' ? 'LIM' : label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (this.channelName) this.handlers.onChannelTier?.(label);
      });
      this.pinButtons.set(label, b);
      pins.append(b);
    }
    this.channelEl.append(h('span', 'channel-label', t('panel.channel')), this.channelStateEl, pins);
    return this.channelEl;
  }

  /** Channel of the current video and the list it is pinned to (null name hides the row). */
  setChannel(name: string | null, tier: Label | null): void {
    this.channelName = name ?? '';
    this.channelEl.classList.toggle('hidden', !this.channelName);
    this.channelEl.title = t('panel.channelTitle', { name: this.channelName });
    this.channelStateEl.textContent = tier ? t('panel.channelIn', { label: tier }) : t('panel.channelNone');
    this.channelStateEl.className = `channel-state ${tier ? `${tier}-text` : ''}`;
    this.pinButtons.forEach((b, l) => {
      b.classList.toggle('selected', l === tier);
      b.setAttribute('aria-pressed', String(l === tier));
      b.title = `${this.channelName} → ${l}`;
    });
  }

  setChannelBusy(busy: boolean): void {
    this.channelEl.classList.toggle('busy', busy);
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
      this.setSignals([]);
      this.setVerdict({ kind: 'idle' });
      this.setChannel(null, null);
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

  setSignals(badges: SignalBadge[]): void {
    this.signalsEl.replaceChildren(
      ...badges.map((b) => {
        const el = h('span', `signal ${b.kind}`, b.text);
        el.title = b.title;
        return el;
      }),
    );
  }

  setLabel(info: LabelInfo | null): void {
    this.current = info;
    if (info?.reason && !this.reasonEl.value) this.reasonEl.value = info.reason;
    this.renderLabel();
  }

  /** Live verdict of the model for the current video. */
  setVerdict(state: VerdictState): void {
    this.verdict = state;
    this.renderVerdict();
  }

  /** Daily quota line ("12 min left of 30 min"); null hides it. */
  setQuota(text: string | null, fraction = 0): void {
    this.quotaEl.classList.toggle('hidden', !text);
    const bar = h('span', 'quota-bar');
    const fill = h('span', 'quota-fill');
    fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    bar.append(fill);
    this.quotaEl.replaceChildren(h('span', 'quota-text', text ?? ''), bar);
  }

  verdictState(): VerdictState {
    return this.verdict;
  }

  /** Badge with the pending count; a hint to refresh the policy past the threshold. */
  setPending(feedback: PendingFeedback | null): void {
    const pending = feedback?.pending ?? 0;
    this.badgeEl.classList.toggle('hidden', pending === 0);
    this.badgeEl.textContent = String(pending);
    this.badgeEl.title = `${pending} etiquetas pendientes de incorporar a la política`;
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
    this.renderVerdict(); // the match with the label may have changed
  }

  private renderVerdict(): void {
    const d = verdictDisplay(this.verdict, this.current?.label ?? null);
    this.verdictEl.className = `verdict ${d.tone}${d.text ? '' : ' hidden'}`;
    this.verdictEl.title = d.title;
    const main = h('span', `verdict-main ${d.tier ? `${d.tier}-text` : ''}`, d.text);
    const extras: HTMLElement[] = [];
    if (d.note) extras.push(h('span', 'verdict-note', d.note));
    if (d.match) extras.push(h('span', `verdict-match ${d.match}`, d.match === 'yes' ? '✓ coincide' : '✗ no coincide'));
    this.verdictEl.replaceChildren(main, ...extras);
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

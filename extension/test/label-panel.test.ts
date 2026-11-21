import { beforeEach, describe, expect, it } from 'vitest';
import { LABELS, type Label } from '../src/types';
import { LabelPanel, levelChip, type PanelHandlers } from '../src/ui/label-panel';
import { PANEL_CSS } from '../src/ui/panel-styles';
import { shortcutLabel, type ShortcutEvent } from '../src/ui/shortcuts';
import { fakeEvent, installFakeDom, type FakeDom, type FakeElement } from './fake-dom';

function key(code: string, keyChar: string, mods: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return { altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, code, key: keyChar, ...mods };
}

describe('shortcutLabel', () => {
  it('maps Alt+1/2/3 to NO/LIMITADO/LIBRE by physical key', () => {
    expect(shortcutLabel(key('Digit1', '1'))).toBe('NO');
    expect(shortcutLabel(key('Digit2', '2'))).toBe('LIMITADO');
    expect(shortcutLabel(key('Digit3', '3'))).toBe('LIBRE');
  });

  it('falls back on the produced character when the code is unknown', () => {
    expect(shortcutLabel(key('', '3'))).toBe('LIBRE');
    expect(shortcutLabel(key('Unidentified', '1'))).toBe('NO');
  });

  it('ignores AltGr (Ctrl+Alt), other modifiers and other keys', () => {
    expect(shortcutLabel(key('Digit3', '#', { ctrlKey: true }))).toBeNull(); // AltGr+3 on Spanish layout
    expect(shortcutLabel(key('Digit3', '3', { getModifierState: (k) => k === 'AltGraph' }))).toBeNull();
    expect(shortcutLabel(key('Digit3', '3', { shiftKey: true }))).toBeNull();
    expect(shortcutLabel(key('Digit3', '3', { altKey: false }))).toBeNull();
    expect(shortcutLabel(key('Digit4', '4'))).toBeNull();
  });
});

describe('LabelPanel', () => {
  let dom: FakeDom;
  let labels: Label[];
  let panel: LabelPanel;

  const handlers = (): PanelHandlers => ({
    onLabel: (label) => labels.push(label),
    onRetry: () => undefined,
    onOpenSettings: () => undefined,
    onOpenCalibration: () => undefined,
  });

  const labelButtons = (): FakeElement[] => dom.documentElement.findAll((el) => el.tagName === 'button' && el.classList.contains('label'));

  beforeEach(() => {
    dom = installFakeDom();
    labels = [];
    panel = new LabelPanel(handlers());
    panel.mount();
    panel.setVideo('abcdefghijk', 'Un vídeo');
  });

  it('renders one button per label, in order, never disabled', () => {
    const buttons = labelButtons();
    expect(buttons.map((b) => b.textContent)).toEqual([...LABELS]);
    expect(buttons.every((b) => b.type === 'button' && !b.disabled)).toBe(true);
    expect(buttons.map((b) => b.attributes.get('aria-keyshortcuts'))).toEqual(['Alt+1', 'Alt+2', 'Alt+3']);
  });

  it('dispatches every label on click, also while the ficha is still being saved', () => {
    panel.setReady(false);
    for (const b of labelButtons()) b.click();
    expect(labels).toEqual(['NO', 'LIMITADO', 'LIBRE']);
  });

  it('dispatches every label from the keyboard and swallows the shortcut', () => {
    const events = ['1', '2', '3'].map((d) => fakeEvent('keydown', { ...key(`Digit${d}`, d) }));
    for (const e of events) dom.window.dispatchEvent(e);
    expect(labels).toEqual(['NO', 'LIMITADO', 'LIBRE']);
    expect(events.every((e) => e.defaultPrevented)).toBe(true);
  });

  it('does nothing without a current video', () => {
    panel.hide();
    labelButtons()[2]!.click();
    dom.window.dispatchEvent(fakeEvent('keydown', { ...key('Digit3', '3') }));
    expect(labels).toEqual([]);
  });

  it('shows the pending badge and the refresh hint past the threshold', () => {
    const badge = () => dom.documentElement.findAll((el) => el.classList.contains('badge'))[0]!;
    const hint = () => dom.documentElement.findAll((el) => el.classList.contains('calibrate'))[0]!;
    panel.setPending({ pending: 0, threshold: 20 });
    expect(badge().classList.contains('hidden')).toBe(true);
    panel.setPending({ pending: 7, threshold: 20 });
    expect(badge().textContent).toBe('7');
    expect(badge().classList.contains('hidden')).toBe(false);
    expect(hint().classList.contains('hidden')).toBe(true);
    panel.setPending({ pending: 20, threshold: 20 });
    expect(hint().classList.contains('hidden')).toBe(false);
    expect(hint().textContent).toContain('Refresca tu política');
  });
});

describe('panel layout', () => {
  it('uses an equal-width grid for the label buttons that cannot overflow', () => {
    expect(PANEL_CSS).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    expect(PANEL_CSS).toMatch(/button\.label \{[^}]*min-width: 0/);
  });

  it('keeps level chips short whatever the state', () => {
    expect(levelChip('L2', 'pending')).toBe('L2…');
    expect(levelChip('L3', 'blocked')).toBe('L3✗');
    expect(levelChip('L1', 'ok')).toBe('L1✓');
    expect(levelChip('L4', undefined)).toBe('L4·');
  });
});

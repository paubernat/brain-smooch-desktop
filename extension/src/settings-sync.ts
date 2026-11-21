// Background: keeps a copy of the gate settings (`enforcement`) and of the UI
// language chosen on the local web in browser.storage.local, refreshed on
// startup and every minute. The content script reads the copy so the gate
// knows whether to fail closed when the service does not answer.
import { ENFORCEMENT_PATH, UI_SETTINGS_PATH } from './api-messages';
import { ENFORCEMENT_KEY, parseEnforcement } from './enforce/settings';
import { isLang, LANG_STORAGE_KEY } from './options/i18n';
import { fetchService } from './service-http';
import type { EnforcementSettings } from './types';

const ALARM = 'bsd-refresh-settings';

export async function refreshSettings(): Promise<void> {
  const [enforcement, ui] = await Promise.all([
    fetchService<EnforcementSettings>('GET', ENFORCEMENT_PATH),
    fetchService<{ language: unknown }>('GET', UI_SETTINGS_PATH),
  ]);
  const items: Record<string, unknown> = {};
  if (enforcement.ok) items[ENFORCEMENT_KEY] = parseEnforcement(enforcement.data);
  if (ui.ok && isLang(ui.data.language)) items[LANG_STORAGE_KEY] = ui.data.language;
  if (Object.keys(items).length) await browser.storage.local.set(items).catch(() => undefined);
}

export function startSettingsSync(): void {
  browser.alarms.create(ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void refreshSettings();
  });
  void refreshSettings();
}

// Background script: does the HTTP calls of the content scripts, opens the
// local web (dashboard, served by the service) on first install or when the
// panel asks for it, blocks the extra websites of the policy (site-blocker.ts)
// and keeps a copy of the enforcement / language settings (settings-sync.ts).
import {
  ALLOWED_PATHS,
  OPTIONS_SECTIONS,
  isApiRequest,
  isOpenOptions,
  timeoutFor,
  type ApiRequestMessage,
  type ApiResult,
  type OpenOptionsMessage,
} from './api-messages';
import { fetchService, localWebUrl } from './service-http';
import { startSettingsSync } from './settings-sync';
import { startSiteBlocker } from './site-blocker';

async function callService(msg: ApiRequestMessage): Promise<ApiResult<unknown>> {
  if (!ALLOWED_PATHS.test(msg.path)) return { ok: false, status: null, error: `path not allowed: ${msg.path}` };
  return fetchService(msg.method, msg.path, msg.body, timeoutFor(msg.path, msg.timeoutMs));
}

/** Opens the local web (at a section, if any) in a new tab. */
async function openOptions(msg: OpenOptionsMessage): Promise<void> {
  const section = msg.section && OPTIONS_SECTIONS.includes(msg.section) ? msg.section : '';
  await browser.tabs.create({ url: await localWebUrl(section) });
}

browser.runtime.onMessage.addListener((message) => {
  // Only our own content scripts can message the background (no externally_connectable).
  if (isOpenOptions(message)) return openOptions(message);
  if (!isApiRequest(message)) return undefined;
  return callService(message);
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void browser.runtime.openOptionsPage();
});

startSiteBlocker();
startSettingsSync();

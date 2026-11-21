// Background script: does the HTTP calls of the content scripts, opens the
// profile page (options page) on first install or when the panel asks for it,
// and blocks the extra websites of the policy (site-blocker.ts).
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
import { fetchService } from './service-http';
import { startSiteBlocker } from './site-blocker';

async function callService(msg: ApiRequestMessage): Promise<ApiResult<unknown>> {
  if (!ALLOWED_PATHS.test(msg.path)) return { ok: false, status: null, error: `path not allowed: ${msg.path}` };
  return fetchService(msg.method, msg.path, msg.body, timeoutFor(msg.path));
}

/** A section opens in a new tab at options.html#<section>; otherwise the usual options page. */
async function openOptions(msg: OpenOptionsMessage): Promise<void> {
  if (msg.section && OPTIONS_SECTIONS.includes(msg.section)) {
    await browser.tabs.create({ url: browser.runtime.getURL(`options.html#${msg.section}`) });
    return;
  }
  await browser.runtime.openOptionsPage();
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

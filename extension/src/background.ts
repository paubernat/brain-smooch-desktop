// Background script: does the HTTP calls of the content scripts and opens the
// profile page (options page) on first install or when the panel asks for it.
import { ALLOWED_PATHS, isApiRequest, isOpenOptions, type ApiRequestMessage, type ApiResult } from './api-messages';
import { fetchService } from './service-http';

async function callService(msg: ApiRequestMessage): Promise<ApiResult<unknown>> {
  if (!ALLOWED_PATHS.test(msg.path)) return { ok: false, status: null, error: `path not allowed: ${msg.path}` };
  return fetchService(msg.method, msg.path, msg.body);
}

browser.runtime.onMessage.addListener((message) => {
  // Only our own content scripts can message the background (no externally_connectable).
  if (isOpenOptions(message)) return browser.runtime.openOptionsPage();
  if (!isApiRequest(message)) return undefined;
  return callService(message);
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') void browser.runtime.openOptionsPage();
});

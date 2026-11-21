// Small key-value storage that works both as an extension page / content
// script (browser.storage.local, per Firefox profile) and as the local web
// served by the service (localStorage of http://127.0.0.1:8765). Values are
// JSON-serialisable.

/** True in extension contexts (background, content scripts, extension pages). */
export function isExtensionContext(): boolean {
  try {
    return typeof browser !== 'undefined' && !!browser.runtime?.id;
  } catch {
    return false;
  }
}

function webStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export async function storageGet(key: string): Promise<unknown> {
  if (isExtensionContext()) {
    try {
      return (await browser.storage.local.get(key))[key];
    } catch {
      return undefined;
    }
  }
  const raw = webStorage()?.getItem(key);
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export async function storageSet(items: Record<string, unknown>): Promise<void> {
  if (isExtensionContext()) {
    await browser.storage.local.set(items).catch(() => undefined);
    return;
  }
  const storage = webStorage();
  if (!storage) return;
  for (const [key, value] of Object.entries(items)) {
    try {
      if (value === null || value === undefined) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(value));
    } catch {
      // quota / private mode: nothing to do
    }
  }
}

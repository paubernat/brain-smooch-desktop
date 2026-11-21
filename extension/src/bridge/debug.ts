// Debug logging for the page world. Enable with localStorage['bsd-debug'] = '1'
// (the content script mirrors the storage.local `debug` flag into it).
export function isDebug(): boolean {
  try {
    return window.localStorage.getItem('bsd-debug') === '1';
  } catch {
    return false;
  }
}

export function debugLog(...args: unknown[]): void {
  if (isDebug()) console.log('[bsd:page]', ...args);
}

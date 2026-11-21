// Minimal ambient typing of the WebExtensions `browser` namespace we use
// (Firefox exposes it natively; no polyfill needed).
declare namespace browser.runtime {
  interface MessageSender {
    id?: string;
    url?: string;
    tab?: { id?: number; url?: string };
  }
  function sendMessage(message: unknown): Promise<unknown>;
  const onMessage: {
    addListener(
      callback: (message: unknown, sender: MessageSender) => Promise<unknown> | undefined | void,
    ): void;
  };
}

declare namespace browser.storage {
  interface StorageChange {
    oldValue?: unknown;
    newValue?: unknown;
  }
  const local: {
    get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  const onChanged: {
    addListener(callback: (changes: Record<string, StorageChange>, areaName: string) => void): void;
  };
}

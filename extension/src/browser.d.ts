// Minimal ambient typing of the WebExtensions `browser` namespace we use
// (Firefox exposes it natively; no polyfill needed).
declare namespace browser.runtime {
  interface MessageSender {
    id?: string;
    url?: string;
    tab?: { id?: number; url?: string };
  }
  interface InstalledDetails {
    reason: 'install' | 'update' | 'browser_update' | 'shared_module_update';
    previousVersion?: string;
    temporary?: boolean;
  }
  function sendMessage(message: unknown): Promise<unknown>;
  function openOptionsPage(): Promise<void>;
  function getURL(path: string): string;
  const onMessage: {
    addListener(
      callback: (message: unknown, sender: MessageSender) => Promise<unknown> | undefined | void,
    ): void;
  };
  const onInstalled: {
    addListener(callback: (details: InstalledDetails) => void): void;
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

declare namespace browser.tabs {
  // No "tabs" permission needed to open a tab with an extension page.
  function create(properties: { url: string; active?: boolean }): Promise<{ id?: number }>;
}

declare namespace browser.webRequest {
  interface RequestDetails {
    url: string;
    type: string;
    tabId: number;
  }
  interface BlockingResponse {
    cancel?: boolean;
    redirectUrl?: string;
  }
  const onBeforeRequest: {
    addListener(
      callback: (details: RequestDetails) => BlockingResponse | Promise<BlockingResponse>,
      filter: { urls: string[]; types?: string[] },
      extraInfoSpec?: 'blocking'[],
    ): void;
  };
}

declare namespace browser.alarms {
  interface Alarm {
    name: string;
  }
  function create(name: string, info: { periodInMinutes?: number; delayInMinutes?: number }): void;
  const onAlarm: {
    addListener(callback: (alarm: Alarm) => void): void;
  };
}

declare namespace browser.permissions {
  interface Permissions {
    origins?: string[];
    permissions?: string[];
  }
  function contains(permissions: Permissions): Promise<boolean>;
  function request(permissions: Permissions): Promise<boolean>;
}

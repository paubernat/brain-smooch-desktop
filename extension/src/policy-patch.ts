// Read-modify-write of the saved policy with optimistic locking: GET /policy,
// apply a change, PUT with expected_version; on 409 (someone saved in the
// meantime) re-read and apply the change again. Transport-agnostic so the
// options page (direct fetch) and the content script (via background) share it.
import type { ApiResult } from './api-messages';

export interface PatchablePolicy<C> {
  version: number;
  content: C;
}

export interface PolicyTransport<C, P extends PatchablePolicy<C>> {
  get(): Promise<ApiResult<P>>;
  put(content: C, expectedVersion: number): Promise<ApiResult<P>>;
}

const MAX_ATTEMPTS = 3;

/** `change` returns null when there is nothing to save (the current policy is returned). */
export async function patchPolicy<C, P extends PatchablePolicy<C>>(
  transport: PolicyTransport<C, P>,
  change: (content: C) => C | null,
): Promise<ApiResult<P> & { changed?: boolean }> {
  let last: ApiResult<P> = { ok: false, status: null, error: 'not attempted' };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const current = await transport.get();
    if (!current.ok) return current;
    const next = change(current.data.content);
    if (next === null) return { ...current, changed: false };
    last = await transport.put(next, current.data.version);
    if (last.ok) return { ...last, changed: true };
    if (last.status !== 409) return last;
  }
  return last;
}

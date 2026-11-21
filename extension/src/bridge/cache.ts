// Small bounded caches filled by the network interceptor (page world).
import type { PlayerResponse } from '../extract/player-types';
import type { AiDisclosure } from '../types';

export class BoundedMap<K, V> extends Map<K, V> {
  constructor(private readonly limit: number) {
    super();
  }
  override set(key: K, value: V): this {
    if (this.has(key)) this.delete(key);
    super.set(key, value);
    while (this.size > this.limit) {
      const oldest = this.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    return this;
  }
}

export interface CapturedTimedtext {
  url: string;
  body: string;
  lang: string | null;
}

/** Player responses seen in /youtubei/v1/player and /youtubei/v1/reel/* responses, by videoId. */
export const playerCache = new BoundedMap<string, PlayerResponse>(60);
/** Game title extracted from /youtubei/v1/next responses, by videoId. */
export const gameCache = new BoundedMap<string, string | null>(60);
/** Creator-disclosed AI label from /youtubei/v1/next and /youtubei/v1/reel/* responses, by videoId. */
export const disclosureCache = new BoundedMap<string, AiDisclosure>(120);
/** timedtext requests made by the player itself (they carry the `pot` token), by videoId. */
export const timedtextCache = new BoundedMap<string, CapturedTimedtext[]>(30);

export function addTimedtext(videoId: string, entry: CapturedTimedtext): void {
  const list = timedtextCache.get(videoId) ?? [];
  list.push(entry);
  timedtextCache.set(videoId, list.slice(-6));
}

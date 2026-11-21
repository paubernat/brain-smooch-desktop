// Creator-disclosed AI label ("Altered or synthetic content"). Pure functions.
//
// Where it lives (observed 2026-11-21 on real pages, see SPIKE.md and the
// next-* / reel-* fixtures): NOT in the player response, but in the watch
// "next" data, inside the description engagement panel:
//
//   engagementPanels[].engagementPanelSectionListRenderer.content
//     .structuredDescriptionContentRenderer.items[].howThisWasMadeSectionViewModel
//       { sectionTitle: "How this was made" / "Cómo se ha hecho",
//         bodyHeader:   "Made with AI" / "Creado con IA",
//         bodyText:     "Sounds or visuals were altered or fully generated. Learn more",
//                       commandRuns[].onTap…url = //support.google.com/youtube/answer/15447836 }
//
// The SAME section also carries YouTube's auto-dubbing notice ("Auto-dubbed" /
// "Doblado automáticamente", help article 15569972), which is NOT an AI label.
// The help-article id in the "Learn more" link is language independent, so it
// is the primary signal; the header/body text (en/es) is the fallback.
//
// Responses that carry it:
//   - /watch: ytInitialData and /youtubei/v1/next   (videoId: currentVideoEndpoint.watchEndpoint)
//   - /shorts: ytInitialData (no videoId inside) and /youtubei/v1/reel/reel_item_watch
//     (videoId: playerResponse.videoDetails); /youtubei/v1/reel/reel_watch_sequence and
//     ytInitialReelWatchSequenceResponse prefetch the NEXT Shorts under
//     entries[].command.reelWatchEndpoint{videoId, unserializedPrefetchData.reelItemWatchResponse}.
// A response without the structured description panel says nothing (no entry);
// one with the panel but without an AI section is a confirmed "not labeled".
//
// Not observed (no sample found): the more prominent player overlay YouTube
// shows for sensitive topics. Defensive guess: a link to the same help article
// anywhere under the item's own overlay (`playerOverlays` / `overlay`). Only
// the link counts, not text, because overlays also list other videos' titles.
import type { AiDisclosure, AiDisclosureSource } from '../types';

export type ResponseSource = Extract<AiDisclosureSource, 'next' | 'reel'>;

export const UNKNOWN_DISCLOSURE: AiDisclosure = Object.freeze({ labeled: false, source: 'unknown' }) as AiDisclosure;

/** support.google.com/youtube/answer/<id> linked from the section. */
export const AI_HELP_ARTICLE = '15447836';
export const AUTO_DUB_HELP_ARTICLE = '15569972';

const AI_TEXT =
  /altered or synthetic|altered or fully generated|made with ai|contenido alterado o sint[eé]tico|alterad[oa]s? o se han generado|creado con ia/i;

const MAX_DEPTH = 12;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function get(node: unknown, ...path: (string | number)[]): unknown {
  let cur: unknown = node;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/** Text of a view-model text ({content}) or a classic one ({simpleText} / {runs}). */
function textOf(t: unknown): string {
  if (!isObj(t)) return '';
  if (typeof t['content'] === 'string') return t['content'];
  if (typeof t['simpleText'] === 'string') return t['simpleText'];
  const runs = t['runs'];
  if (Array.isArray(runs)) return runs.map((r) => (isObj(r) && typeof r['text'] === 'string' ? r['text'] : '')).join('');
  return '';
}

/** Every string value under `node` (bounded), e.g. to find help-article links. */
function strings(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > MAX_DEPTH) return out;
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((v) => strings(v, out, depth + 1));
  else if (isObj(node)) Object.values(node).forEach((v) => strings(v, out, depth + 1));
  return out;
}

/** Body text without the trailing "Learn more" / "Más información" link. */
function bodyWithoutLink(body: unknown): string {
  const text = textOf(body);
  const runs = get(body, 'commandRuns');
  const start = Array.isArray(runs) && isObj(runs[0]) ? runs[0]['startIndex'] : undefined;
  return (typeof start === 'number' && start > 0 ? text.slice(0, start) : text).trim();
}

/** One "How this was made" section: is it the AI label? */
export function classifySection(section: unknown): { labeled: boolean; text: string } {
  const header = textOf(get(section, 'bodyHeader')).trim();
  const body = bodyWithoutLink(get(section, 'bodyText'));
  const text = [header, body].filter(Boolean).join(': ');
  const links = strings(section).filter((s) => s.includes('/answer/'));
  if (links.some((l) => l.includes(`/answer/${AI_HELP_ARTICLE}`))) return { labeled: true, text };
  if (links.some((l) => l.includes(`/answer/${AUTO_DUB_HELP_ARTICLE}`)) && !AI_TEXT.test(text)) return { labeled: false, text };
  return { labeled: AI_TEXT.test(text), text };
}

/**
 * Disclosure from one item's engagement panels (a next response, a reel item
 * response or ytInitialData). `null` when there is no structured description
 * panel, i.e. the item cannot tell.
 */
export function disclosureFromPanels(engagementPanels: unknown, source: ResponseSource): AiDisclosure | null {
  if (!Array.isArray(engagementPanels)) return null;
  let sawDescription = false;
  for (const panel of engagementPanels) {
    const items = get(panel, 'engagementPanelSectionListRenderer', 'content', 'structuredDescriptionContentRenderer', 'items');
    if (!Array.isArray(items)) continue;
    sawDescription = true;
    for (const item of items) {
      const section = get(item, 'howThisWasMadeSectionViewModel');
      if (!isObj(section)) continue;
      const { labeled, text } = classifySection(section);
      if (labeled) return text ? { labeled: true, source, text } : { labeled: true, source };
    }
  }
  return sawDescription ? { labeled: false, source } : null;
}

function nextVideoId(data: unknown): string | null {
  return str(get(data, 'currentVideoEndpoint', 'watchEndpoint', 'videoId'));
}

function reelItemVideoId(data: unknown): string | null {
  return (
    str(get(data, 'playerResponse', 'videoDetails', 'videoId')) ??
    str(get(data, 'replacementEndpoint', 'reelWatchEndpoint', 'videoId')) ??
    str(get(data, 'currentVideoEndpoint', 'watchEndpoint', 'videoId'))
  );
}

/**
 * All disclosures a response carries, by videoId.
 * - `source: 'next'`: /youtubei/v1/next or /watch ytInitialData.
 * - `source: 'reel'`: /youtubei/v1/reel/* (item or sequence), /shorts ytInitialData,
 *   ytInitialReelWatchSequenceResponse. `hintVideoId` names the item when the
 *   response itself does not (the /shorts ytInitialData, a reel_item_watch
 *   request body); it is never applied to sequence entries.
 */
export function aiDisclosuresFromResponse(data: unknown, source: ResponseSource, hintVideoId: string | null = null): Map<string, AiDisclosure> {
  const out = new Map<string, AiDisclosure>();
  if (!isObj(data)) return out;

  const entries = data['entries'];
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const endpoint = get(entry, 'command', 'reelWatchEndpoint');
      const vid = str(get(endpoint, 'videoId'));
      const item = get(endpoint, 'unserializedPrefetchData', 'reelItemWatchResponse');
      const found = vid ? disclosureFromPanels(get(item, 'engagementPanels'), 'reel') : null;
      if (vid && found) out.set(vid, found);
    }
  }

  const vid = source === 'next' ? (nextVideoId(data) ?? hintVideoId) : (reelItemVideoId(data) ?? hintVideoId);
  let found = disclosureFromPanels(data['engagementPanels'], source);
  if (!found?.labeled && overlayLinksAiArticle(data[source === 'next' ? 'playerOverlays' : 'overlay'])) {
    found = { labeled: true, source };
  }
  if (vid && found) out.set(vid, found);
  return out;
}

function overlayLinksAiArticle(overlay: unknown): boolean {
  return strings(overlay).some((s) => s.includes(`/answer/${AI_HELP_ARTICLE}`));
}

/** videoId requested in a /youtubei/v1/reel/reel_item_watch (or next) request body. */
export function requestVideoId(body: string | null | undefined): string | null {
  if (!body) return null;
  try {
    const json: unknown = JSON.parse(body);
    return str(get(json, 'playerRequest', 'videoId')) ?? str(get(json, 'videoId'));
  } catch {
    return null;
  }
}

/**
 * `ytInitialReelWatchSequenceResponse` is a JSON string on /shorts pages
 * (sometimes already an object); anything else gives null.
 */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

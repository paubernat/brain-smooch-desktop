import { describe, expect, it } from 'vitest';
import {
  aiDisclosuresFromResponse,
  classifySection,
  disclosureFromPanels,
  parseMaybeJson,
  requestVideoId,
} from '../src/extract/ai-disclosure';
import { extractLive } from '../src/extract/live';
import {
  clone,
  LIVE_NOW,
  LIVE_PAST,
  LIVE_UPCOMING,
  NEXT_AI_EN,
  NEXT_AI_ES,
  NEXT_AUTODUB,
  NEXT_NONE,
  REEL_INITIAL_AUTODUB,
  REEL_ITEM_AI,
  REEL_SEQUENCE,
  SHORT_CHORDS,
  WATCH_NEURAL,
} from './fixtures';

const AI_EN = 'Made with AI: Sounds or visuals were altered or fully generated.';
const AI_ES = 'Creado con IA: Los sonidos o las imágenes están alteradas o se han generado completamente.';

describe('aiDisclosuresFromResponse (real fixtures)', () => {
  it('watch ytInitialData with the label (en)', () => {
    const found = aiDisclosuresFromResponse(NEXT_AI_EN, 'next');
    expect([...found]).toEqual([['3wHHSYxka74', { labeled: true, source: 'next', text: AI_EN }]]);
  });

  it('/youtubei/v1/next with the label (es)', () => {
    expect(aiDisclosuresFromResponse(NEXT_AI_ES, 'next').get('3wHHSYxka74')).toEqual({ labeled: true, source: 'next', text: AI_ES });
  });

  it('auto-dubbing uses the same section but is NOT an AI label', () => {
    expect(aiDisclosuresFromResponse(NEXT_AUTODUB, 'next').get('402VxfR7fRQ')).toEqual({ labeled: false, source: 'next' });
  });

  it('AI-generated video without disclosure: confirmed not labeled', () => {
    expect(aiDisclosuresFromResponse(NEXT_NONE, 'next').get('2BthJJ_zJgU')).toEqual({ labeled: false, source: 'next' });
  });

  it('/youtubei/v1/reel/reel_item_watch: videoId from the embedded player response', () => {
    const found = aiDisclosuresFromResponse(REEL_ITEM_AI, 'reel');
    expect(found.get('cZ44YIQXShY')).toEqual({ labeled: true, source: 'reel', text: AI_ES });
  });

  it('/shorts ytInitialData has no videoId: needs the hint', () => {
    expect(aiDisclosuresFromResponse(REEL_INITIAL_AUTODUB, 'reel').size).toBe(0);
    expect(aiDisclosuresFromResponse(REEL_INITIAL_AUTODUB, 'reel', '6Y-3qIzFlLk').get('6Y-3qIzFlLk')).toEqual({
      labeled: false,
      source: 'reel',
    });
  });

  it('reel sequence: prefetched entries keyed by their own videoId, hint never applied', () => {
    const found = aiDisclosuresFromResponse(REEL_SEQUENCE, 'reel', '6Y-3qIzFlLk');
    expect(found.get('V04T6e14kIs')).toEqual({ labeled: true, source: 'reel', text: AI_EN });
    expect(found.has('6Y-3qIzFlLk')).toBe(false); // the page's own Short is not in the sequence
    expect(found.has('QQqLyAUM_9I')).toBe(false); // no prefetched data: unknown, not "false"
  });

  it('the ytInitialReelWatchSequenceResponse string form is parsed', () => {
    expect(aiDisclosuresFromResponse(parseMaybeJson(JSON.stringify(REEL_SEQUENCE)), 'reel').has('V04T6e14kIs')).toBe(true);
    expect(parseMaybeJson('not json')).toBeNull();
    expect(parseMaybeJson(undefined)).toBeNull();
  });
});

describe('classifySection', () => {
  const section = (header: string, body: string, article?: string) => ({
    bodyHeader: { content: header },
    bodyText: {
      content: `${body} Learn more`,
      commandRuns: article
        ? [{ startIndex: body.length + 1, onTap: { innertubeCommand: { urlEndpoint: { url: `//support.google.com/youtube/answer/${article}` } } } }]
        : [],
    },
  });

  it('help article 15447836 means AI whatever the language', () => {
    expect(classifySection(section('生成AI', '変更または生成', '15447836')).labeled).toBe(true);
  });

  it('falls back on the text without a known link', () => {
    expect(classifySection(section('Altered or synthetic content', 'Sound or visuals were significantly edited')).labeled).toBe(true);
    expect(classifySection(section('Contenido alterado o sintético', 'El sonido o las imágenes se han editado')).labeled).toBe(true);
    expect(classifySection(section('Auto-dubbed', 'Audio tracks were automatically generated', '15569972')).labeled).toBe(false);
    expect(classifySection(section('Captured with a camera', 'Content credentials')).labeled).toBe(false);
  });

  it('drops the "Learn more" link from the text', () => {
    expect(classifySection(section('Made with AI', 'Sounds were generated.', '15447836')).text).toBe('Made with AI: Sounds were generated.');
  });
});

describe('defensive parsing', () => {
  it('no structured description panel: cannot tell (no entry)', () => {
    expect(disclosureFromPanels(undefined, 'next')).toBeNull();
    expect(disclosureFromPanels([{ engagementPanelSectionListRenderer: { content: {} } }], 'next')).toBeNull();
    expect(aiDisclosuresFromResponse({ currentVideoEndpoint: { watchEndpoint: { videoId: 'x' } } }, 'next').size).toBe(0);
    expect(aiDisclosuresFromResponse(null, 'next').size).toBe(0);
    expect(aiDisclosuresFromResponse('text', 'reel').size).toBe(0);
  });

  it('player overlay linking the AI help article counts (sensitive-topic overlay, not observed)', () => {
    const data = clone(NEXT_NONE) as Record<string, unknown>;
    data['playerOverlays'] = { x: { url: 'https://support.google.com/youtube/answer/15447836' } };
    expect(aiDisclosuresFromResponse(data, 'next').get('2BthJJ_zJgU')).toEqual({ labeled: true, source: 'next' });
  });

  it('requestVideoId reads reel_item_watch and next request bodies', () => {
    expect(requestVideoId('{"playerRequest":{"videoId":"cZ44YIQXShY"}}')).toBe('cZ44YIQXShY');
    expect(requestVideoId('{"videoId":"3wHHSYxka74"}')).toBe('3wHHSYxka74');
    expect(requestVideoId('nope')).toBeNull();
    expect(requestVideoId(null)).toBeNull();
  });
});

describe('extractLive (real fixtures)', () => {
  it('live now', () => {
    expect(extractLive(LIVE_NOW)).toEqual({ is_live_now: true, was_live: false, is_upcoming: false });
  });

  it('scheduled', () => {
    expect(extractLive(LIVE_UPCOMING)).toEqual({ is_live_now: false, was_live: false, is_upcoming: true });
  });

  it('recording of a finished live stream', () => {
    expect(extractLive(LIVE_PAST)).toEqual({ is_live_now: false, was_live: true, is_upcoming: false });
  });

  it('regular videos and Shorts', () => {
    const none = { is_live_now: false, was_live: false, is_upcoming: false };
    expect(extractLive(WATCH_NEURAL)).toEqual(none);
    expect(extractLive(SHORT_CHORDS)).toEqual(none);
  });

  it('isLiveNow alone is enough', () => {
    const pr = clone(LIVE_NOW);
    delete pr.videoDetails!.isLive;
    expect(extractLive(pr).is_live_now).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import type { Snapshot } from '../src/bridge-protocol';
import { buildFicha } from '../src/extract/ficha';
import { parseVideoUrl } from '../src/url';
import { JSON3_ASR, SHORT_CHORDS, WATCH_NEURAL } from './fixtures';

describe('parseVideoUrl', () => {
  it('recognises watch, shorts and live URLs', () => {
    expect(parseVideoUrl('https://www.youtube.com/watch?v=aircAruvnKk&t=10')).toEqual({ videoId: 'aircAruvnKk', isShortUrl: false });
    expect(parseVideoUrl('https://www.youtube.com/shorts/ib6nIB-fbNE')).toEqual({ videoId: 'ib6nIB-fbNE', isShortUrl: true });
    expect(parseVideoUrl('https://www.youtube.com/live/aircAruvnKk?si=1')).toEqual({ videoId: 'aircAruvnKk', isShortUrl: false });
    expect(parseVideoUrl('https://www.youtube.com/')).toBeNull();
    expect(parseVideoUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    expect(parseVideoUrl('https://example.com/watch?v=aircAruvnKk')).toBeNull();
  });
});

describe('buildFicha -> POST /fichas payload', () => {
  it('Short with transcript', () => {
    const snapshot: Snapshot = {
      videoId: 'ib6nIB-fbNE',
      source: 'shorts_player',
      playerResponse: SHORT_CHORDS,
      game: null,
      aiDisclosure: { labeled: true, source: 'reel', text: 'Made with AI' },
      captions: { status: 'ok', track: { languageCode: 'en', kind: 'asr' }, json3: JSON3_ASR, via: 'captured', attempts: [] },
    };
    const f = buildFicha(snapshot, { videoId: 'ib6nIB-fbNE', isShortUrl: true });
    expect(f.video_id).toBe('ib6nIB-fbNE');
    expect(f.url).toBe('https://www.youtube.com/shorts/ib6nIB-fbNE');
    expect(f.metadata.is_short).toBe(true);
    expect(f.transcript.status).toBe('ok');
    expect(f.transcript.segments.length).toBeGreaterThan(0);
    expect(f.storyboard?.sprite_urls.length).toBe(7);
    expect(f.metadata.ai_disclosure).toEqual({ labeled: true, source: 'reel', text: 'Made with AI' });
    expect(f.metadata.live).toEqual({ is_live_now: false, was_live: false, is_upcoming: false });
  });

  it('long video with blocked captions', () => {
    const snapshot: Snapshot = {
      videoId: 'aircAruvnKk',
      source: 'initial',
      playerResponse: WATCH_NEURAL,
      game: null,
      aiDisclosure: { labeled: false, source: 'unknown' },
      captions: { status: 'blocked', track: { languageCode: 'en', kind: 'manual' }, json3: null, via: null, attempts: [] },
    };
    const f = buildFicha(snapshot, { videoId: 'aircAruvnKk', isShortUrl: false });
    expect(f.url).toBe('https://www.youtube.com/watch?v=aircAruvnKk');
    expect(f.transcript).toEqual({ status: 'blocked', language: 'en', kind: 'manual', segments: [] });
    expect(f.metadata.chapters).toHaveLength(12);
    expect(f.metadata.ai_disclosure).toEqual({ labeled: false, source: 'unknown' });
  });
});

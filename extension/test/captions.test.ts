import { describe, expect, it } from 'vitest';
import {
  buildTranscript,
  detectVideoLanguage,
  json3Url,
  listCaptionTracks,
  parseJson3,
  selectCaptionTrack,
  timedtextKey,
  withPlayerToken,
} from '../src/extract/captions';
import type { PlayerResponse } from '../src/extract/player-types';
import { clone, JSON3_ASR, JSON3_MANUAL, SHORT_CHORDS, WATCH_NEURAL } from './fixtures';

describe('track selection (real fixtures)', () => {
  it('Short with only an English asr track', () => {
    expect(listCaptionTracks(SHORT_CHORDS)).toHaveLength(1);
    expect(detectVideoLanguage(SHORT_CHORDS)).toBe('en');
    expect(selectCaptionTrack(SHORT_CHORDS)).toMatchObject({ languageCode: 'en', kind: 'asr' });
  });

  it('long video: video language (en) manual beats en asr and es manual', () => {
    expect(listCaptionTracks(WATCH_NEURAL).length).toBeGreaterThan(20);
    expect(detectVideoLanguage(WATCH_NEURAL)).toBe('en');
    const t = selectCaptionTrack(WATCH_NEURAL);
    expect(t).toMatchObject({ languageCode: 'en', kind: 'manual' });
    expect(t!.baseUrl).toContain('/api/timedtext?v=aircAruvnKk');
  });

  it('falls back to es when the video language has no track', () => {
    const pr = clone(WATCH_NEURAL);
    const tracks = pr.captions!.playerCaptionsTracklistRenderer!.captionTracks!;
    pr.captions!.playerCaptionsTracklistRenderer!.captionTracks = tracks.filter((t) => t.languageCode !== 'en');
    pr.captions!.playerCaptionsTracklistRenderer!.audioTracks = [];
    expect(selectCaptionTrack(pr)).toMatchObject({ languageCode: 'es', kind: 'manual' });
  });

  it('video language from asr track (e.g. es video with en manual subs)', () => {
    const pr: PlayerResponse = {
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=en', languageCode: 'en' },
            { baseUrl: 'https://www.youtube.com/api/timedtext?v=x&lang=es&kind=asr', languageCode: 'es', kind: 'asr' },
          ],
        },
      },
    };
    expect(selectCaptionTrack(pr)).toMatchObject({ languageCode: 'es', kind: 'asr' });
  });

  it('no captions -> null', () => {
    expect(selectCaptionTrack({})).toBeNull();
  });
});

describe('URLs', () => {
  it('json3Url sets fmt=json3 once', () => {
    const u = new URL(json3Url('https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=srv3'));
    expect(u.searchParams.getAll('fmt')).toEqual(['json3']);
  });

  it('withPlayerToken copies pot and client params', () => {
    const captured = 'https://www.youtube.com/api/timedtext?v=x&lang=en&fmt=json3&pot=TOKEN123&c=WEB&cver=2.2026';
    const u = new URL(withPlayerToken('https://www.youtube.com/api/timedtext?v=x&lang=es', captured)!);
    expect(u.searchParams.get('pot')).toBe('TOKEN123');
    expect(u.searchParams.get('c')).toBe('WEB');
    expect(u.searchParams.get('lang')).toBe('es');
    expect(u.searchParams.get('fmt')).toBe('json3');
    expect(withPlayerToken('https://www.youtube.com/api/timedtext?v=x', 'https://www.youtube.com/api/timedtext?v=x')).toBeNull();
  });

  it('timedtextKey', () => {
    expect(timedtextKey('/api/timedtext?v=abc&lang=en')).toEqual({ videoId: 'abc', lang: 'en' });
    expect(timedtextKey('https://www.youtube.com/youtubei/v1/player')).toBeNull();
  });
});

describe('parseJson3 (synthetic json3 fixtures)', () => {
  it('ASR style: joins word segs, skips append/newline and window events', () => {
    const segs = parseJson3(JSON3_ASR);
    expect(segs).toEqual([
      { start_s: 0.16, text: 'these chords are so nasty' },
      { start_s: 2.48, text: 'start with a minor nine chord' },
      { start_s: 4.24, text: 'and move the top voice down' },
      { start_s: 8.14, text: '[Music]' },
    ]);
  });

  it('manual style: collapses newlines, skips whitespace-only events', () => {
    const segs = parseJson3(JSON3_MANUAL);
    expect(segs).toHaveLength(5);
    expect(segs[1]).toEqual({ start_s: 7.46, text: "It's sloppily written and rendered at an extremely low resolution" });
    expect(segs[2]!.text).toBe('of 28x28 pixels, but your brain has no trouble');
    expect(segs[4]!.start_s).toBe(67);
  });

  it('throws on non-JSON (e.g. empty body)', () => {
    expect(() => parseJson3('')).toThrow();
  });
});

describe('buildTranscript', () => {
  const track = { baseUrl: '', languageCode: 'en', kind: 'asr' as const };
  it('ok', () => {
    const t = buildTranscript(track, 'ok', JSON3_ASR);
    expect(t).toMatchObject({ status: 'ok', language: 'en', kind: 'asr' });
    expect(t.segments).toHaveLength(4);
  });
  it('none / blocked keep segments empty', () => {
    expect(buildTranscript(null, 'none', null)).toEqual({ status: 'none', language: null, kind: null, segments: [] });
    expect(buildTranscript(track, 'blocked', null)).toEqual({ status: 'blocked', language: 'en', kind: 'asr', segments: [] });
  });
  it('ok but empty / malformed body -> blocked', () => {
    expect(buildTranscript(track, 'ok', '').status).toBe('blocked');
    expect(buildTranscript(track, 'ok', '{"events":[]}').status).toBe('blocked');
    expect(buildTranscript(track, 'ok', '<xml/>').status).toBe('blocked');
  });
});

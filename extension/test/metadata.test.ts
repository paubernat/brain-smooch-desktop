import { describe, expect, it } from 'vitest';
import { extractGame, extractMetadata, isShort, parseChapters, timestampToSeconds } from '../src/extract/metadata';
import { clone, SHORT_CHORDS, SHORT_MINOR67, WATCH_NEURAL } from './fixtures';

describe('extractMetadata (real fixtures)', () => {
  it('Short ib6nIB-fbNE', () => {
    const m = extractMetadata(SHORT_CHORDS, { isShortUrl: true });
    expect(m.title).toBe("These Chords So Nasty (you've been warned)");
    expect(m.channel_name).toBe('Jeff Schneider');
    expect(m.channel_id).toBe('UCFKJ7NEE5S76QYK696nXDfg');
    expect(m.category).toBe('Music');
    expect(m.duration_s).toBe(120);
    expect(m.is_short).toBe(true);
    expect(m.publish_date).toBe('2026-05-22');
    expect(m.is_family_safe).toBe(true);
    expect(m.keywords).toContain('jazz piano');
    expect(m.description_raw).toContain('Chord Theory for R&B Piano: https://');
    expect(m.chapters).toEqual([]);
    expect(m.game).toBeNull();
  });

  it('Short without keywords -> []', () => {
    const m = extractMetadata(SHORT_MINOR67, { isShortUrl: false });
    expect(m.keywords).toEqual([]);
    expect(m.is_short).toBe(true); // canonicalUrl is /shorts/
    expect(m.channel_name).toBe('Open Studio');
  });

  it('long video aircAruvnKk with chapters', () => {
    const m = extractMetadata(WATCH_NEURAL, { isShortUrl: false, game: null });
    expect(m.is_short).toBe(false);
    expect(m.category).toBe('Education');
    expect(m.duration_s).toBe(1120);
    expect(m.publish_date).toBe('2017-10-05');
    expect(m.chapters).toHaveLength(12);
    expect(m.chapters[0]).toEqual({ start_s: 0, title: 'Introduction example' });
    expect(m.chapters[1]).toEqual({ start_s: 67, title: 'Series preview' });
    expect(m.chapters[11]).toEqual({ start_s: 1023, title: 'ReLU vs Sigmoid' });
    expect(m.chapters.some((c) => c.title.includes('Correction'))).toBe(false);
  });

  it('tolerates an empty player response', () => {
    const m = extractMetadata({}, { isShortUrl: false });
    expect(m).toMatchObject({ title: '', duration_s: 0, keywords: [], category: null, is_short: false, chapters: [] });
  });
});

describe('isShort criterion', () => {
  it('URL /shorts/ wins', () => {
    expect(isShort(WATCH_NEURAL, true)).toBe(true);
  });
  it('canonicalUrl /shorts/ even when opened via /watch', () => {
    expect(isShort(SHORT_CHORDS, false)).toBe(true);
  });
  it('fallback: <=180 s and vertical', () => {
    const pr = clone(SHORT_CHORDS);
    pr.microformat!.playerMicroformatRenderer!.canonicalUrl = 'https://www.youtube.com/watch?v=ib6nIB-fbNE';
    expect(isShort(pr, false)).toBe(true);
    pr.videoDetails!.lengthSeconds = '181';
    expect(isShort(pr, false)).toBe(false);
  });
  it('short but horizontal is not a Short', () => {
    const pr = clone(WATCH_NEURAL);
    pr.videoDetails!.lengthSeconds = '60';
    expect(isShort(pr, false)).toBe(false);
  });
});

describe('parseChapters', () => {
  it('parses separators and h:mm:ss', () => {
    const d = 'Intro text\n00:00 Start\n(1:30) Middle part\n1:02:03 | Late\nfin';
    expect(parseChapters(d)).toEqual([
      { start_s: 0, title: 'Start' },
      { start_s: 90, title: 'Middle part' },
      { start_s: 3723, title: 'Late' },
    ]);
  });
  it('requires >= 2 ascending timestamps', () => {
    expect(parseChapters('0:00 only one')).toEqual([]);
    expect(parseChapters('2:00 b\n1:00 a')).toEqual([]);
  });
  it('drops chapters beyond the duration', () => {
    expect(parseChapters('0:00 a\n9:00 b', 120)).toEqual([]);
  });
  it('timestampToSeconds', () => {
    expect(timestampToSeconds('1:07')).toBe(67);
    expect(timestampToSeconds('1:75')).toBeNull();
  });
});

describe('extractGame', () => {
  it('finds the box-art rich metadata', () => {
    const next = {
      contents: [
        { foo: 1 },
        { richMetadataRowRenderer: { contents: [{ richMetadataRenderer: { style: 'RICH_METADATA_RENDERER_STYLE_BOX_ART', title: { simpleText: 'League of Legends' } } }] } },
      ],
    };
    expect(extractGame(next)).toBe('League of Legends');
    expect(extractGame({ a: { b: [] } })).toBeNull();
    expect(extractGame(null)).toBeNull();
  });
});

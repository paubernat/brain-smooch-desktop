import { describe, expect, it } from 'vitest';
import { buildStoryboard, parseStoryboardSpec, pickBestLevel, pickThumbnail, spriteUrls } from '../src/extract/storyboard';
import { SHORT_CHORDS, SHORT_MINOR67, WATCH_NEURAL } from './fixtures';

const specOf = (pr: typeof WATCH_NEURAL) => pr.storyboards!.playerStoryboardSpecRenderer!.spec!;

describe('parseStoryboardSpec (real specs)', () => {
  it('long video: template + 4 levels', () => {
    const p = parseStoryboardSpec(specOf(WATCH_NEURAL))!;
    expect(p.template).toBe(
      'https://i.ytimg.com/sb/aircAruvnKk/storyboard3_L$L/$N.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgivyL_HBg==',
    );
    expect(p.levels).toHaveLength(4);
    expect(p.levels[0]).toMatchObject({ index: 0, width: 48, height: 27, frameCount: 100, intervalMs: 0, name: 'default' });
    expect(p.levels[3]).toEqual({
      index: 3,
      width: 320,
      height: 180,
      frameCount: 113,
      columns: 3,
      rows: 3,
      intervalMs: 10000,
      name: 'M$M',
      sigh: 'rs$AOn4CLCsSJzLDRBsYCmQTxvysPXjr5mp8w',
    });
  });

  it('Short: vertical levels', () => {
    const p = parseStoryboardSpec(specOf(SHORT_CHORDS))!;
    expect(pickBestLevel(p.levels)).toMatchObject({ index: 3, width: 101, height: 180, frameCount: 62, intervalMs: 2000 });
  });

  it('rejects garbage', () => {
    expect(parseStoryboardSpec('')).toBeNull();
    expect(parseStoryboardSpec('not a url|1#2')).toBeNull();
    expect(parseStoryboardSpec('https://x/y.jpg|a#b#c#d#e#f#g#h')).toBeNull();
  });
});

describe('sprite URLs', () => {
  it('long video: 13 sheets of 3x3 at L3 with sigh', () => {
    const p = parseStoryboardSpec(specOf(WATCH_NEURAL))!;
    const urls = spriteUrls(p.template, pickBestLevel(p.levels)!);
    expect(urls).toHaveLength(13); // ceil(113 / 9)
    expect(urls[0]).toBe(
      'https://i.ytimg.com/sb/aircAruvnKk/storyboard3_L3/M0.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgivyL_HBg==&sigh=rs$AOn4CLCsSJzLDRBsYCmQTxvysPXjr5mp8w',
    );
    expect(urls[12]).toContain('/storyboard3_L3/M12.jpg?');
  });

  it('"default" level (no $M) yields a single URL', () => {
    const p = parseStoryboardSpec(specOf(SHORT_MINOR67))!;
    const urls = spriteUrls(p.template, p.levels[0]!);
    expect(urls).toEqual([
      'https://i.ytimg.com/sb/oyxs-4jk0Tg/storyboard3_L0/default.jpg?sqp=-oaymwENSDfyq4qpAwVwAcABBqLzl_8DBgiw8fTNBg==&sigh=rs$AOn4CLDCsgEkeXb1RlAu9Pb0fyzbmq3OYA',
    ]);
  });

  it('template without query string uses ?sigh=', () => {
    const p = parseStoryboardSpec('https://i.ytimg.com/sb/x/storyboard3_L$L/$N.jpg|10#10#4#2#2#1000#M$M#abc')!;
    expect(spriteUrls(p.template, p.levels[0]!)).toEqual(['https://i.ytimg.com/sb/x/storyboard3_L0/M0.jpg?sigh=abc']);
  });
});

describe('buildStoryboard', () => {
  it('contract shape for the long video', () => {
    const sb = buildStoryboard(WATCH_NEURAL, 'aircAruvnKk')!;
    expect(sb.level).toEqual({ width: 320, height: 180, frame_count: 113, columns: 3, rows: 3, interval_ms: 10000 });
    expect(sb.sprite_urls).toHaveLength(13);
    expect(sb.thumbnail_url).toBe('https://i.ytimg.com/vi_webp/aircAruvnKk/maxresdefault.webp');
  });

  it('Short: 7 sheets, maxres thumbnail', () => {
    const sb = buildStoryboard(SHORT_CHORDS, 'ib6nIB-fbNE')!;
    expect(sb.sprite_urls).toHaveLength(7); // ceil(62 / 9)
    expect(sb.thumbnail_url).toBe('https://i.ytimg.com/vi/ib6nIB-fbNE/maxresdefault.jpg');
  });

  it('no spec -> null; no thumbnails -> hqdefault', () => {
    expect(buildStoryboard({}, 'abcdefghijk')).toBeNull();
    expect(pickThumbnail({}, 'abcdefghijk')).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  });
});

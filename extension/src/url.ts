// Pure helpers to recognise video pages from a URL.

export interface VideoRef {
  videoId: string;
  isShortUrl: boolean;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseVideoUrl(href: string): VideoRef | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;

  if (url.pathname === '/watch') {
    const v = url.searchParams.get('v');
    return v && VIDEO_ID.test(v) ? { videoId: v, isShortUrl: false } : null;
  }
  const m = /^\/(shorts|live)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/.exec(url.pathname);
  if (m && m[2]) return { videoId: m[2], isShortUrl: m[1] === 'shorts' };
  return null;
}

export function canonicalVideoUrl(ref: VideoRef): string {
  return ref.isShortUrl
    ? `https://www.youtube.com/shorts/${ref.videoId}`
    : `https://www.youtube.com/watch?v=${ref.videoId}`;
}

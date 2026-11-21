// Snapshot (from page-bridge) -> POST /fichas payload. Pure.
import type { Snapshot } from '../bridge-protocol';
import { canonicalVideoUrl, type VideoRef } from '../url';
import type { FichaPayload } from '../types';
import { buildTranscript, type Track } from './captions';
import { extractMetadata } from './metadata';
import { buildStoryboard } from './storyboard';

export function buildFicha(snapshot: Snapshot, ref: VideoRef): FichaPayload {
  const pr = snapshot.playerResponse;
  const metadata = extractMetadata(pr, { isShortUrl: ref.isShortUrl, game: snapshot.game, aiDisclosure: snapshot.aiDisclosure });
  const c = snapshot.captions;
  const track: Track | null = c.track ? { baseUrl: '', languageCode: c.track.languageCode, kind: c.track.kind } : null;
  return {
    video_id: snapshot.videoId,
    url: canonicalVideoUrl({ videoId: snapshot.videoId, isShortUrl: metadata.is_short }),
    metadata,
    transcript: buildTranscript(track, c.status, c.json3),
    storyboard: buildStoryboard(pr, snapshot.videoId),
  };
}

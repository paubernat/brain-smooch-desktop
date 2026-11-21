// Live-stream state from the player response. Pure.
//
// Observed on real responses (2026-11-21, fixtures player-live/upcoming/pastlive-*.json):
//   live now:   videoDetails.isLive = true, isLiveContent = true, liveBroadcastDetails.isLiveNow = true
//   upcoming:   videoDetails.isUpcoming = true, isLiveContent = true, isLiveNow = false (no endTimestamp)
//   past live:  isLiveContent = true, isLive/isUpcoming absent, isLiveNow = false, endTimestamp set
import type { LiveInfo } from '../types';
import type { PlayerResponse } from './player-types';

export function extractLive(pr: PlayerResponse): LiveInfo {
  const vd = pr.videoDetails ?? {};
  const broadcast = pr.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
  const isLiveNow = vd.isLive === true || broadcast?.isLiveNow === true;
  const isUpcoming = !isLiveNow && vd.isUpcoming === true;
  const wasLive = !isLiveNow && !isUpcoming && (vd.isLiveContent === true || !!broadcast?.endTimestamp);
  return { is_live_now: isLiveNow, was_live: wasLive, is_upcoming: isUpcoming };
}

// Minimal, defensive typing of the parts of YouTube's player response we read.
// Everything is optional: YouTube changes this structure without notice.

export interface Thumbnail {
  url?: string;
  width?: number;
  height?: number;
}

export interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string; // "asr" for auto-generated, absent for manual
  vssId?: string;
  name?: { simpleText?: string };
}

export interface AudioTrack {
  captionTrackIndices?: number[];
  defaultCaptionTrackIndex?: number;
}

export interface Format {
  itag?: number;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface PlayerResponse {
  playabilityStatus?: { status?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    keywords?: string[];
    channelId?: string;
    shortDescription?: string;
    author?: string;
    isLiveContent?: boolean;
    isLive?: boolean;
    isUpcoming?: boolean;
    thumbnail?: { thumbnails?: Thumbnail[] };
  };
  microformat?: {
    playerMicroformatRenderer?: {
      category?: string;
      publishDate?: string;
      uploadDate?: string;
      isFamilySafe?: boolean;
      canonicalUrl?: string;
      isShortsEligible?: boolean;
      ownerChannelName?: string;
      externalChannelId?: string;
      liveBroadcastDetails?: {
        isLiveNow?: boolean;
        startTimestamp?: string;
        endTimestamp?: string;
      };
    };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
      audioTracks?: AudioTrack[];
      defaultAudioTrackIndex?: number;
    };
  };
  storyboards?: {
    playerStoryboardSpecRenderer?: { spec?: string };
    playerLiveStoryboardSpecRenderer?: { spec?: string };
  };
  streamingData?: {
    formats?: Format[];
    adaptiveFormats?: Format[];
  };
}

/** Keeps only the keys we use, so postMessage payloads and fixtures stay small. */
export function trimPlayerResponse(pr: PlayerResponse): PlayerResponse {
  const dims = (f: Format): Format => ({ itag: f.itag, mimeType: f.mimeType, width: f.width, height: f.height });
  const trimmed: PlayerResponse = {
    playabilityStatus: { status: pr.playabilityStatus?.status },
    videoDetails: pr.videoDetails,
    microformat: pr.microformat,
    captions: pr.captions,
    storyboards: pr.storyboards,
    streamingData: {
      formats: (pr.streamingData?.formats ?? []).map(dims),
      adaptiveFormats: (pr.streamingData?.adaptiveFormats ?? []).filter((f) => f.width).slice(0, 4).map(dims),
    },
  };
  // Plain JSON copy: strips functions/proxies before crossing worlds.
  return JSON.parse(JSON.stringify(trimmed)) as PlayerResponse;
}

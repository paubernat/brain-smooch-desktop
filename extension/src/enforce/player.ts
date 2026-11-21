// The YouTube player as the gate sees it: pause every <video> while the gate
// holds, find the main video for the quota (position / duration) and seek.
// Media events do not bubble, so the hold listens in the capture phase.

export class PlayerHold {
  constructor(private readonly shouldHold: () => boolean) {
    document.addEventListener(
      'play',
      (event) => {
        if (event.target instanceof HTMLMediaElement && this.shouldHold()) event.target.pause();
      },
      true,
    );
  }

  /** Re-check now (after a state change): pause everything if holding. */
  apply(): void {
    if (this.shouldHold()) pauseAll();
  }
}

export function pauseAll(): void {
  for (const video of Array.from(document.querySelectorAll('video'))) {
    if (!video.paused) video.pause();
  }
}

const MAIN_VIDEO_SELECTORS = ['ytd-reel-video-renderer[is-active] video', '#shorts-player video', '#movie_player video', 'video.html5-main-video'];

/** The video on screen (on Shorts, the active one). */
export function mainVideo(): HTMLVideoElement | null {
  for (const selector of MAIN_VIDEO_SELECTORS) {
    const el = document.querySelector(selector);
    if (el instanceof HTMLVideoElement) return el;
  }
  const playing = Array.from(document.querySelectorAll('video')).find((v) => !v.paused);
  return playing ?? document.querySelector('video');
}

export interface Progress {
  duration: number | null;
  position: number | null;
  playing: boolean;
}

export function progress(): Progress {
  const video = mainVideo();
  if (!video) return { duration: null, position: null, playing: false };
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
  return { duration, position: Number.isFinite(video.currentTime) ? video.currentTime : null, playing: !video.paused && !video.ended };
}

export function seekTo(seconds: number): void {
  const video = mainVideo();
  if (video && Number.isFinite(seconds) && seconds > 0) video.currentTime = seconds;
}

// Runs at document_start on youtube.com (isolated world): when the gate is on,
// a video page must not autoplay during the second or two before content.js
// (document_idle) takes over. Pauses every video until content.js announces
// itself with `bsd-gate-ready`; if it never does, the video stays paused
// (fail closed).
import { ENFORCEMENT_KEY, parseEnforcement } from './enforce/settings';
import { parseVideoUrl } from './url';

let released = false;

function onPlay(event: Event): void {
  if (released || !parseVideoUrl(location.href)) return;
  if (event.target instanceof HTMLMediaElement) event.target.pause();
}

document.addEventListener('bsd-gate-ready', () => {
  released = true;
  document.removeEventListener('play', onPlay, true);
});

void browser.storage.local
  .get(ENFORCEMENT_KEY)
  .then((stored) => {
    if (!released && parseEnforcement(stored[ENFORCEMENT_KEY]).mode === 'soft') document.addEventListener('play', onPlay, true);
  })
  .catch(() => undefined);

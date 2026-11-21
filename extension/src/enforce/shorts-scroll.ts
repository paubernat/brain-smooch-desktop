// Shorts feed detection (docs/BACKLOG.md, Shorts). Pure, unit-tested.
//
// The scroll feed is blocked whatever the verdict; a single Short reached from
// elsewhere (a link, a search, a watch page, the home page, a full page load)
// is judged like any other video. Criterion: two consecutive SPA navigations
// that land on Shorts — i.e. an in-page navigation from one Short to a
// different Short — is scrolling. A reload or a link opened in a new tab is a
// full page load, never scrolling.
import type { VideoRef } from '../url';

export type PageKind = 'short' | 'watch' | 'other';

export interface NavStep {
  kind: PageKind;
  videoId: string | null;
}

export function navStep(ref: VideoRef | null): NavStep {
  if (!ref) return { kind: 'other', videoId: null };
  return { kind: ref.isShortUrl ? 'short' : 'watch', videoId: ref.videoId };
}

/** `spa`: the page did not reload between `previous` and `next`. */
export function isShortsScroll(previous: NavStep | null, next: NavStep, spa: boolean): boolean {
  return spa && next.kind === 'short' && previous?.kind === 'short' && previous.videoId !== next.videoId;
}

/** Remembers the previous page of this tab (the content script lives as long as the page). */
export class NavTracker {
  private last: NavStep | null = null;

  /** Records a page; true if reaching it was scrolling the Shorts feed. */
  visit(step: NavStep): boolean {
    const spa = this.last !== null; // the first page this script sees came from a full load
    const scroll = isShortsScroll(this.last, step, spa);
    if (this.last?.kind !== step.kind || this.last.videoId !== step.videoId) this.last = step;
    return scroll;
  }
}

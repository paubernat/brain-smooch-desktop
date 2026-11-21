// A statue (craftsman or robot) with its light level: segments ignite in order
// as the setup progresses, and a "pulse" flashes it (calibration refresh).
import { statueSvg, type StatueKind } from '../art/statues';
import { h } from '../dom';
import { t } from '../i18n';
import { STATUE_SEGMENTS, lightPercent, litSegments } from '../progress';

const PULSE_EVENT = 'bsd-statue-pulse';
const PULSE_MS = 1400;

/** Flash every statue on the page (e.g. after a calibration refresh is saved). */
export function pulseStatues(): void {
  window.dispatchEvent(new Event(PULSE_EVENT));
}

export class Statue {
  readonly element: HTMLElement;
  private readonly art: SVGSVGElement;
  private readonly readout = h('span', { className: 'light-readout mono' });
  private readonly ticks: HTMLElement[];
  private light = -1;

  constructor(kind: StatueKind, light: number, readonly size: 'large' | 'small' = 'large') {
    this.art = statueSvg(kind);
    this.ticks = STATUE_SEGMENTS.map(() => h('span', { className: 'tick' }));
    this.element = h(
      'figure',
      { className: `statue-frame statue-${size}` },
      this.art,
      h('figcaption', { className: 'light-meter' }, h('span', { className: 'ticks', attrs: { 'aria-hidden': 'true' } }, ...this.ticks), this.readout),
    );
    this.setLight(light, false);
    const onPulse = () => {
      if (!this.element.isConnected) return window.removeEventListener(PULSE_EVENT, onPulse);
      this.pulse();
    };
    window.addEventListener(PULSE_EVENT, onPulse);
  }

  /** Light 0..1; `animate` makes newly lit segments flicker on like a neon tube. */
  setLight(light: number, animate = true): void {
    if (light === this.light) return;
    const lit = new Set(litSegments(light));
    for (const group of this.art.querySelectorAll<SVGGElement>('.seg')) {
      const seg = group.dataset.seg as (typeof STATUE_SEGMENTS)[number];
      const on = lit.has(seg);
      if (on && animate && !group.classList.contains('lit')) {
        group.classList.add('igniting');
        setTimeout(() => group.classList.remove('igniting'), 1200);
      }
      group.classList.toggle('lit', on);
    }
    this.ticks.forEach((tick, i) => tick.classList.toggle('on', i < lit.size));
    this.element.classList.toggle('full', light >= 1);
    this.readout.textContent = t('landing.light', { pct: lightPercent(light) });
    this.light = light;
  }

  pulse(): void {
    this.element.classList.remove('pulse');
    void this.element.getBoundingClientRect(); // restart the animation
    this.element.classList.add('pulse');
    setTimeout(() => this.element.classList.remove('pulse'), PULSE_MS);
  }
}

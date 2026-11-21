// Tiny SVG builder (createElementNS; no innerHTML).
const NS = 'http://www.w3.org/2000/svg';

export type SvgAttrs = Record<string, string | number>;

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  for (const child of children) el.appendChild(child);
  return el;
}

/** A path; class "solid" fills it with the background so it hides what is behind. */
export function path(d: string, cls = ''): SVGPathElement {
  return svg('path', cls ? { d, class: cls } : { d });
}

export function circle(cx: number, cy: number, r: number, cls = ''): SVGCircleElement {
  return svg('circle', cls ? { cx, cy, r, class: cls } : { cx, cy, r });
}

export function rect(x: number, y: number, width: number, height: number, rx = 0, cls = ''): SVGRectElement {
  const attrs: SvgAttrs = { x, y, width, height, rx };
  if (cls) attrs.class = cls;
  return svg('rect', attrs);
}

export function group(cls: string, ...children: SVGElement[]): SVGGElement {
  return svg('g', { class: cls }, ...children);
}

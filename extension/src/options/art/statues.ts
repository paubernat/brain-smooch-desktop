// Original neon line-art for the landing squares, drawn as stroked SVG paths
// (viewBox 0 0 200 260). Each statue is split into the five segments that
// ignite in order (progress.ts). Shapes with class "solid" are filled with the
// background colour so overlapping parts read as in front.
import type { StatueSegment } from '../progress';
import { circle, group, path, rect, svg } from './svg';

export type StatueKind = 'craftsman' | 'robot';

type SegmentShapes = Record<StatueSegment, SVGElement[]>;

const VIEW_BOX = '0 0 200 260';
/** Drawing order (back to front); lighting order is STATUE_SEGMENTS. */
const DRAW_ORDER: readonly StatueSegment[] = ['base', 'torso', 'legs', 'arms', 'head'];

function plinth(...extra: SVGElement[]): SVGElement[] {
  return [path('M30 252 H170'), path('M44 230 H156 L162 240 V252 H38 V240 Z', 'solid'), path('M44 240 H156'), ...extra];
}

/** Dark-fantasy armoured smith: horned great helm, cape, plate, a war hammer planted on the plinth. */
function craftsman(): SegmentShapes {
  return {
    base: plinth(path('M58 246 H88'), path('M112 246 H142'), circle(100, 246, 3)),
    legs: [
      path('M86 160 L83 194 L80 224 H96 L97 194 L98 160', 'solid'),
      path('M102 160 L103 194 L104 224 H120 L117 194 L114 160', 'solid'),
      path('M80 190 Q89 183 98 190 L96 198 Q89 194 82 198 Z', 'solid'),
      path('M102 190 Q111 183 120 190 L118 198 Q111 194 104 198 Z', 'solid'),
      path('M76 230 L80 224 H97 L99 230 Z', 'solid'),
      path('M101 230 L104 224 H120 L124 230 Z', 'solid'),
    ],
    torso: [
      path('M78 100 Q60 152 62 218 L74 226'),
      path('M122 100 Q140 152 138 218 L126 226'),
      path('M80 147 L72 174 L88 169 L100 176 L112 169 L128 174 L120 147 Z', 'solid'),
      path('M78 98 Q100 88 122 98 L119 138 Q100 147 81 138 Z', 'solid'),
      path('M100 94 V142'),
      path('M83 114 Q100 122 117 114'),
      path('M84 128 Q100 136 116 128'),
      rect(80, 139, 40, 8, 1, 'solid'),
      rect(96, 139, 8, 8, 1),
    ],
    arms: [
      // war hammer, behind the right fist
      path('M150 110 V206 M155 110 V206'),
      rect(148, 102, 9, 8, 1),
      rect(132, 204, 40, 24, 2, 'solid'),
      path('M140 204 V228 M164 204 V228 M132 216 H172'),
      // left arm
      path('M58 110 L72 113 L68 140 L54 138 Z', 'solid'),
      path('M54 140 L68 142 L66 162 L55 161 Z', 'solid'),
      rect(54, 161, 13, 11, 2, 'solid'),
      // right arm, fist around the haft
      path('M142 110 L128 113 L134 138 L147 135 Z', 'solid'),
      path('M134 138 L147 135 L152 154 L141 158 Z', 'solid'),
      rect(141, 154, 18, 12, 2, 'solid'),
      // pauldrons
      path('M80 98 Q60 86 52 108 Q62 118 78 112 Z', 'solid'),
      path('M57 103 Q66 96 78 102'),
      path('M120 98 Q140 86 148 108 Q138 118 122 112 Z', 'solid'),
      path('M143 103 Q134 96 122 102'),
    ],
    head: [
      circle(100, 68, 34, 'halo'),
      path('M88 56 Q72 50 72 32 Q80 44 90 48'),
      path('M112 56 Q128 50 128 32 Q120 44 110 48'),
      path('M86 62 Q86 48 100 46 Q114 48 114 62 L115 86 Q100 94 85 86 Z', 'solid'),
      path('M100 74 V90'),
      circle(94, 81, 1.2),
      circle(106, 81, 1.2),
      path('M88 91 Q100 98 112 91'),
      path('M89 69 H111', 'eyes'),
    ],
  };
}

/** Robot statue: boxy head with antenna, chest core, clawed arms. */
function robot(): SegmentShapes {
  return {
    base: plinth(path('M58 246 H80 L86 240 H94'), path('M142 246 H120 L114 240 H106'), circle(100, 240, 3)),
    legs: [
      rect(80, 152, 40, 10, 2, 'solid'),
      rect(82, 162, 14, 28, 3, 'solid'),
      rect(104, 162, 14, 28, 3, 'solid'),
      rect(81, 198, 16, 26, 3, 'solid'),
      rect(103, 198, 16, 26, 3, 'solid'),
      circle(89, 194, 5, 'solid'),
      circle(111, 194, 5, 'solid'),
      path('M76 230 L80 224 H98 L100 230 Z', 'solid'),
      path('M100 230 L102 224 H120 L124 230 Z', 'solid'),
    ],
    torso: [
      rect(72, 96, 56, 56, 8, 'solid'),
      rect(84, 105, 32, 18, 3),
      path('M88 111 H112 M88 117 H104'),
      path('M78 104 V144 M122 104 V144'),
      circle(100, 137, 7),
      circle(100, 137, 3, 'eyes'),
    ],
    arms: [
      rect(56, 114, 14, 26, 4, 'solid'),
      circle(63, 144, 4, 'solid'),
      rect(55, 148, 16, 22, 3, 'solid'),
      path('M57 170 L52 181 M63 170 V183 M69 170 L74 181'),
      rect(130, 114, 14, 26, 4, 'solid'),
      circle(137, 144, 4, 'solid'),
      rect(129, 148, 16, 22, 3, 'solid'),
      path('M131 170 L126 181 M137 170 V183 M143 170 L148 181'),
      circle(64, 104, 9, 'solid'),
      circle(136, 104, 9, 'solid'),
    ],
    head: [
      circle(100, 70, 34, 'halo'),
      path('M100 52 V37'),
      rect(94, 86, 12, 10, 1, 'solid'),
      rect(78, 52, 44, 36, 9, 'solid'),
      circle(76, 70, 3, 'solid'),
      circle(124, 70, 3, 'solid'),
      path('M90 79 H110 M92 83 H108'),
      rect(86, 63, 11, 7, 2, 'eyes'),
      rect(103, 63, 11, 7, 2, 'eyes'),
      circle(100, 34, 3, 'eyes'),
    ],
  };
}

const BUILDERS: Record<StatueKind, () => SegmentShapes> = { craftsman, robot };

export function statueSvg(kind: StatueKind): SVGSVGElement {
  const shapes = BUILDERS[kind]();
  return svg(
    'svg',
    { viewBox: VIEW_BOX, class: `statue statue-${kind}`, 'aria-hidden': 'true', focusable: 'false' },
    ...DRAW_ORDER.map((seg) => svg('g', { class: `seg seg-${seg}`, 'data-seg': seg }, ...shapes[seg])),
  );
}

/** Rocket on a launch pad with its gantry; the exhaust shows while launching. */
export function rocketSvg(): SVGSVGElement {
  return svg(
    'svg',
    { viewBox: '0 0 200 280', class: 'statue rocket', 'aria-hidden': 'true', focusable: 'false' },
    group(
      'seg seg-stars',
      path('M28 62 h8 M32 58 v8'),
      path('M166 40 h8 M170 36 v8'),
      path('M40 142 h5 M42.5 139.5 v5'),
      circle(60, 30, 1.2),
      circle(176, 120, 1.2),
    ),
    group(
      'seg seg-pad',
      path('M40 236 H160 M52 236 V250 M148 236 V250 M44 250 H156'),
      path('M152 236 V96 M164 236 V96 M152 96 H164'),
      path('M152 120 L164 140 M164 120 L152 140 M152 160 L164 180 M164 160 L152 180 M152 200 L164 220 M164 200 L152 220'),
      path('M152 132 H124'),
    ),
    group(
      'rocket-craft',
      group(
        'seg seg-flame',
        path('M82 210 C84 238 96 250 100 272 C104 250 116 238 118 210 Z', 'flame-outer'),
        path('M90 210 C92 228 98 238 100 252 C102 238 108 228 110 210 Z', 'flame-inner'),
      ),
      group(
        'seg seg-body',
        path('M78 168 L58 206 V214 L78 202 Z', 'solid'),
        path('M122 168 L142 206 V214 L122 202 Z', 'solid'),
        path('M86 196 H114 L118 208 H82 Z', 'solid'),
        path('M100 44 C120 64 124 96 122 128 V196 H78 V128 C76 96 80 64 100 44 Z', 'solid'),
        path('M84 84 H116 M78 160 H122 M100 176 V196'),
        circle(100, 116, 11),
        circle(100, 116, 5, 'eyes'),
      ),
    ),
  );
}

// icons.js — inline SVG icons (stroke style), built with createElementNS.
import { svg, setIconFactory } from './dom.js';

const P = (d) => ['path', { d }];
const L = (x1, y1, x2, y2) => ['line', { x1, y1, x2, y2 }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const PL = (points) => ['polyline', { points }];

const ICONS = {
  scan: [P('M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2'), L(7, 12, 17, 12)],
  box: [P('M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z'), PL('3.27 6.96 12 12.01 20.73 6.96'), L(12, 22.08, 12, 12)],
  clock: [C(12, 12, 10), PL('12 6 12 12 16 14')],
  list: [L(8, 6, 21, 6), L(8, 12, 21, 12), L(8, 18, 21, 18), L(3, 6, 3.01, 6), L(3, 12, 3.01, 12), L(3, 18, 3.01, 18)],
  menu: [L(3, 6, 21, 6), L(3, 12, 21, 12), L(3, 18, 21, 18)],
  plus: [L(12, 5, 12, 19), L(5, 12, 19, 12)],
  minus: [L(5, 12, 19, 12)],
  x: [L(18, 6, 6, 18), L(6, 6, 18, 18)],
  check: [PL('20 6 9 17 4 12')],
  search: [C(11, 11, 8), L(21, 21, 16.65, 16.65)],
  flash: [['polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }]],
  undo: [PL('1 4 1 10 7 10'), P('M3.51 15a9 9 0 1 0 2.13-9.36L1 10')],
  download: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), PL('7 10 12 15 17 10'), L(12, 15, 12, 3)],
  upload: [P('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'), PL('17 8 12 3 7 8'), L(12, 3, 12, 15)],
  trash: [PL('3 6 5 6 21 6'), P('M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2')],
  edit: [P('M12 20h9'), P('M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z')],
  sun: [C(12, 12, 5), L(12, 1, 12, 3), L(12, 21, 12, 23), L(4.22, 4.22, 5.64, 5.64), L(18.36, 18.36, 19.78, 19.78), L(1, 12, 3, 12), L(21, 12, 23, 12), L(4.22, 19.78, 5.64, 18.36), L(18.36, 5.64, 19.78, 4.22)],
  moon: [P('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z')],
  send: [L(22, 2, 11, 13), P('M22 2l-7 20-4-9-9-4 20-7z')],
  alert: [P('M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'), L(12, 9, 12, 13), L(12, 17, 12.01, 17)],
  camera: [P('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'), C(12, 13, 4)],
  clipboard: [P('M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'), ['rect', { x: 8, y: 2, width: 8, height: 4, rx: 1 }]],
  zoom: [C(11, 11, 8), L(21, 21, 16.65, 16.65), L(11, 8, 11, 14), L(8, 11, 14, 11)],
  database: [['ellipse', { cx: 12, cy: 5, rx: 9, ry: 3 }], P('M21 12c0 1.66-4 3-9 3s-9-1.34-9-3'), P('M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5')],
  keyboard: [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }], L(6, 8, 6.01, 8), L(10, 8, 10.01, 8), L(14, 8, 14.01, 8), L(18, 8, 18.01, 8), L(8, 16, 16, 16)],
  link: [P('M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'), P('M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71')],
};

export function icon(name, size = 22) {
  const spec = ICONS[name] || [];
  return svg('svg', {
    viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false',
  }, ...spec.map(([tag, a]) => svg(tag, a)));
}
setIconFactory(() => icon('x'));

// Трек на 2D-слое поверх карты: призрак маршрута, пройденная линия со свечением, переезды пунктиром,
// «голова» и маркеры старта/финиша. Вид — профиль стиля (`StyleDef.line`, `marker`). Координаты — CSS-пиксели MAP_VIEWPORT (в них же даёт точки map.project).
// Геометрия (prepareTrack, displayIndexAtHead, visibleDisplay) — чистая и тестируется без браузера.
import { beatTitle, t } from '../i18n';
import { isWaypointRoute } from '../story/legs';
import { mercX, mercY, TILE_SIZE } from '../story/mercator';
import type { Enrichment, FrameState, Lang, Route, ViewSize } from '../types';
import { layoutFor, waypointOverviewObstacles, WORK_AREA, type Rect } from './layout';
import type { StyleDef } from './styles';
import { drawWaypointLayer, waypointLineIntersects } from './waypoint-layer';

export interface TrackModel {
  /** Число точек отрисовки (route.display). */
  n: number;
  /** Индексы route.points для каждой точки отрисовки. */
  idx: Int32Array;
  lon: Float64Array;
  lat: Float64Array;
  /** Web Mercator в долях мира [0..1]. */
  mx: Float64Array;
  my: Float64Array;
  /** transferSeg[k] = 1, если между display[k] и display[k+1] есть переезд (n − 1 элементов). */
  transferSeg: Uint8Array;
  /** Рабочие массивы проекции (n + 1: последний слот — «голова»). */
  sx: Float64Array;
  sy: Float64Array;
  have: Uint8Array;
  keep: Uint8Array;
  /** Реально нарисованные плашки, CSS-пиксели; географические выноски учитывают их как препятствия. */
  labelBoxes?: Rect[];
}

export function prepareTrack(route: Route): TrackModel {
  const pts = route.points;
  const disp = route.display.length >= 2 ? route.display : [0, Math.max(0, pts.length - 1)];
  const n = disp.length;
  const idx = Int32Array.from(disp);
  const lon = new Float64Array(n), lat = new Float64Array(n), mx = new Float64Array(n), my = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const p = pts[idx[k]];
    lon[k] = p.lon; lat[k] = p.lat; mx[k] = mercX(p.lon); my[k] = mercY(p.lat);
  }
  // префиксные суммы переездов: «перед точкой j есть переезд» → число таких точек среди 0..j
  const transferPrefix = new Int32Array(pts.length);
  let acc = 0;
  for (let j = 0; j < pts.length; j++) {
    if (pts[j].transferBefore || (j > 0 && pts[j].seg !== pts[j - 1].seg)) acc++;
    transferPrefix[j] = acc;
  }
  const transferSeg = new Uint8Array(Math.max(0, n - 1));
  for (let k = 0; k < n - 1; k++) {
    transferSeg[k] = transferPrefix[idx[k + 1]] - transferPrefix[idx[k]] > 0 ? 1 : 0;
  }
  return {
    n, idx, lon, lat, mx, my, transferSeg,
    sx: new Float64Array(n + 1), sy: new Float64Array(n + 1), have: new Uint8Array(n + 1),
    keep: new Uint8Array(n),
  };
}

/** Последняя точка отрисовки, не дальше головы (дробный индекс в route.points). */
export function displayIndexAtHead(m: TrackModel, head: number): number {
  if (m.n === 0 || !(head > m.idx[0])) return 0;
  let lo = 0, hi = m.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (m.idx[mid] <= head) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * Какие точки отрисовки нужно проецировать: лежащие в круге (cx, cy, r) — доли мира — и по одному соседу
 * с каждой стороны, чтобы отрезки, уходящие за круг, дорисовывались до края. out — для повторного использования.
 */
export function visibleDisplay(m: TrackModel, cx: number, cy: number, r: number, out?: Uint8Array): Uint8Array {
  const keep = out && out.length >= m.n ? out : new Uint8Array(m.n);
  keep.fill(0, 0, m.n);
  const r2 = r * r;
  for (let k = 0; k < m.n; k++) {
    const dx = m.mx[k] - cx, dy = m.my[k] - cy;
    if (dx * dx + dy * dy <= r2) {
      keep[k] = 1;
      if (k > 0) keep[k - 1] = 1;
      if (k + 1 < m.n) keep[k + 1] = 1;
    }
  }
  return keep;
}

// ───────────────────────── отрисовка ─────────────────────────

export type Project = (lon: number, lat: number) => { x: number; y: number };
export type ProjectTrack = (lon: number, lat: number) => { x: number; y: number } | null;

export interface TrackDrawArgs {
  ctx: CanvasRenderingContext2D;        // трансформ уже переведён в CSS-пиксели карты
  model: TrackModel;
  route: Route;
  enrichment: Enrichment | null;
  lang: Lang;
  frame: FrameState;
  project: Project;
  /** Track-only depth guard. Other geographic layers keep the existing Project. */
  projectTrack?: ProjectTrack;
  style: StyleDef;
  view: ViewSize;                       // MAP_VIEWPORT
  /** Отключает дублирующие подписи сопровождения; общий план сохраняет ориентиры старта/конца. */
  endpointLabels?: boolean;
}

const HEAD = -1;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Радиус отсечения в долях мира: с запасом на наклон (дальний край кадра уходит за круг). */
function cullRadius(frame: FrameState, view: ViewSize): number {
  const world = TILE_SIZE * 2 ** frame.camera.zoom;
  const half = Math.hypot(view.width, view.height) / 2;
  const pitchFactor = frame.camera.pitch > 0.02 ? 3.2 : 1.15;
  return (half * pitchFactor) / world;
}

/** Сборщик контуров: сплошной (со сглаживанием по серединам звеньев) и пунктирный для переездов. */
class PathBuilder {
  readonly solid = new Path2D();
  readonly dash = new Path2D();
  private runEnd = Number.NaN;   // индекс, на котором закончился текущий сплошной кусок
  private lastX = 0;
  private lastY = 0;
  constructor(private readonly sx: Float64Array, private readonly sy: Float64Array) {}

  /** a, b — слоты проекции (последний слот — «голова»). */
  segment(a: number, b: number, transfer: boolean): void {
    const ax = this.sx[a], ay = this.sy[a], bx = this.sx[b], by = this.sy[b];
    if (transfer) {
      this.close();
      this.dash.moveTo(ax, ay);
      this.dash.lineTo(bx, by);
      return;
    }
    if (this.runEnd !== a) {
      this.close();
      this.solid.moveTo(ax, ay);
    }
    // Только записанные вершины: сглаживание Bézier срезало реальные повороты.
    this.solid.lineTo(bx, by);
    this.lastX = bx; this.lastY = by;
    this.runEnd = b;
  }

  /** Дотянуть открытый сплошной кусок до его последней точки. */
  close(): void {
    if (!Number.isNaN(this.runEnd)) this.solid.lineTo(this.lastX, this.lastY);
    this.runEnd = Number.NaN;
  }
}

/** Дизайн-пиксели Full HD → CSS-пиксели карты (MAP_VIEWPORT вдвое меньше дизайн-размера). */
const css = (designPx: number) => designPx / 2;
/** Ширина свечения линии относительно её толщины: свечение одно, узкое. */
export const GLOW_SPREAD = 3;

function lineStyle(ctx: CanvasRenderingContext2D, color: string, width: number, alpha = 1): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Высота плашки подписи, CSS-пиксели. */
const labelHeight = (style: StyleDef): number => css(style.type.label.size) * 1.7;

interface LabelBox { x: number; y: number; w: number; h: number; padX: number; lines: string[]; lineHeight: number; fontPx: number }

/**
 * Прямоугольник подписи с нижним краем `y` и центром `x`: роль `label` стиля, целиком в рабочей зоне формата
 * (истории 82–83) и левее колонки итогов 16:9. Ставит шрифт в `ctx` (вызывать внутри save/restore).
 */
function labelBox(a: TrackDrawArgs, text: string, x: number, y: number, wrap = false,
  fontPx = css(a.style.type.label.size), bounds?: Rect): LabelBox {
  const { ctx, style, view } = a;
  const role = style.type.label;
  ctx.font = `${role.weight} ${fontPx}px ${style.fonts.label}`;
  const padX = fontPx * 0.6;
  const format = view.width < view.height ? '9:16' : '16:9';
  const work = WORK_AREA[format];
  const layout = layoutFor(format, style.id);
  const left = bounds?.x ?? work.x / 2, top = bounds?.y ?? work.y / 2;
  const right = bounds ? bounds.x + bounds.w : (layout.summaryDock === 'right' ? layout.summary.x - 20 : work.x + work.w) / 2;
  const bottom = bounds ? bounds.y + bounds.h : (work.y + work.h) / 2;
  const maxText = (bounds ? bounds.w : Math.min(right - left, css(work.w) * 0.65)) - padX * 2;
  const lines: string[] = [];
  if (wrap && ctx.measureText(text).width > maxText) {
    let line = '';
    for (const word of text.split(/\s+/)) {
      if (line && ctx.measureText(`${line} ${word}`).width > maxText) { lines.push(line); line = ''; }
      // Одно длинное слово тоже сохраняется целиком: переносим, не обрезаем название.
      for (const char of word) {
        if (ctx.measureText(line + char).width > maxText) { lines.push(line); line = ''; }
        line += char;
      }
      line += ' ';
    }
    if (line.trim()) lines.push(line.trim());
  } else lines.push(text);
  const lineHeight = fontPx * 1.2;
  const h = fontPx * 1.7 + (lines.length - 1) * lineHeight;
  const w = Math.max(...lines.map(line => ctx.measureText(line.trim()).width)) + padX * 2;
  return { x: clamp(x - w / 2, left, right - w), y: clamp(y - h, top, bottom - h), w, h, padX,
    lines: lines.map(line => line.trim()), lineHeight, fontPx };
}

const boxesOverlap = (p: Rect, q: Rect, gap = 4): boolean =>
  p.x < q.x + q.w + gap && q.x < p.x + p.w + gap && p.y < q.y + q.h + gap && q.y < p.y + p.h + gap;

/** Подпись над маркером: роль `label` стиля, скругление — `marker.labelRadius`; прижимается к рабочей зоне кадра. */
function drawLabel(a: TrackDrawArgs, text: string, x: number, y: number, alpha: number, placed?: LabelBox): void {
  const { ctx, style } = a;
  ctx.save();
  ctx.textBaseline = 'middle';
  const measured = labelBox(a, text, x, y);
  const { x: bx, y: by, w, h, padX, lines, lineHeight, fontPx } = placed ?? measured;
  a.model.labelBoxes?.push({ x: bx, y: by, w, h });
  ctx.font = `${style.type.label.weight} ${fontPx}px ${style.fonts.label}`;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = style.palette.cardBg;
  roundRect(ctx, bx, by, w, h, Math.min(style.marker.labelRadius, h / 2));
  ctx.fill();
  ctx.strokeStyle = style.palette.accent;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = style.palette.text;
  lines.forEach((line, i) => ctx.fillText(line, bx + padX, by + h / 2 + 0.5 + (i - (lines.length - 1) / 2) * lineHeight));
  ctx.restore();
}

/** Ближайшее свободное место: проверяем края препятствий и рабочей зоны, затем выбираем минимальный сдвиг. */
function placeWaypointLabel(a: TrackDrawArgs, text: string, x: number, y: number, occupied: Rect[],
  pack = false, fontPx = css(a.style.type.label.size)): LabelBox | null {
  const box = labelBox(a, text, x, y, true, fontPx);
  const format = a.view.width < a.view.height ? '9:16' : '16:9';
  const work = WORK_AREA[format];
  const left = css(work.x), top = css(work.y);
  const right = css(work.x + work.w), bottom = css(work.y + work.h);
  const gap = 5;
  const xs = [box.x, left, right - box.w];
  const ys = [box.y, top, bottom - box.h];
  for (const r of occupied) {
    xs.push(r.x - box.w - gap, r.x + r.w + gap);
    ys.push(r.y - box.h - gap, r.y + r.h + gap);
  }
  // Полная проекция пунктирных связей, включая ещё не раскрытые: подпись не садится на маршрут.
  const projected = a.route.points.map(p => a.project(p.lon, p.lat));
  for (let px = left; px <= right - box.w; px += Math.max(20, box.w / 2)) xs.push(px);
  for (let py = top; py <= bottom - box.h; py += Math.max(20, box.h)) ys.push(py);
  let best: LabelBox | null = null, distance = Infinity;
  // Если вся область занята пунктиром, резервируем ближайшее место и обрезаем только пунктир под подписью.
  for (const avoidLine of pack ? [] : [true, false]) {
    for (const px of xs) for (const py of ys) {
      const candidate = { ...box, x: px, y: py };
      if (px < left || py < top || px + box.w > right || py + box.h > bottom) continue;
      if (occupied.some((r) => boxesOverlap(candidate, r))) continue;
      if (avoidLine && projected.some((p, i) => i > 0 && waypointLineIntersects([projected[i - 1].x, projected[i - 1].y, p.x, p.y], candidate, css(a.style.line.width) + 5))) continue;
      const d = (px - box.x) ** 2 + (py - box.y) ** 2;
      if (d < distance) { best = candidate; distance = d; }
    }
    if (best) return best;
  }
  // Длинный текст может не войти ни в одну позицию исходной плашки. Переносим его
  // в свободные прямоугольники, уменьшая кегль только до самой мелкой роли стиля.
  // Последний резерв — край кадра, тоже с проверкой препятствий. Пунктир под
  // выбранной плашкой обрезается drawWaypointLayer; выноска сохраняет привязку.
  const minimum = css(format === '16:9' ? 24 : Math.min(a.style.type.kicker.size, a.style.type.secondary.size));
  for (const area of [{ x: left, y: top, w: right - left, h: bottom - top },
    { x: 5, y: 5, w: a.view.width - 10, h: a.view.height - 10 }]) {
    const edgesX = [...new Set([area.x, area.x + area.w, ...occupied.flatMap(r => [r.x - gap, r.x + r.w + gap])])]
      .filter(v => v >= area.x && v <= area.x + area.w).sort((a, b) => a - b);
    const edgesY = [...new Set([area.y, area.y + area.h, ...occupied.flatMap(r => [r.y - gap, r.y + r.h + gap])])]
      .filter(v => v >= area.y && v <= area.y + area.h).sort((a, b) => a - b);
    const spaces: Rect[] = [];
    for (let i = 0; i < edgesX.length; i++) for (const endX of edgesX.slice(i + 1))
      for (let j = 0; j < edgesY.length; j++) for (const endY of edgesY.slice(j + 1)) {
        const r = { x: edgesX[i], y: edgesY[j], w: endX - edgesX[i], h: endY - edgesY[j] };
        if (r.w >= minimum * 3 && r.h >= minimum * 1.7 && !occupied.some(o => boxesOverlap(r, o))) spaces.push(r);
      }
    for (let size = box.fontPx; size >= minimum; size--) {
      best = null; distance = Infinity;
      for (const space of spaces) {
        const candidate = labelBox(a, text, pack ? space.x : x, pack ? space.y : y, true, size, space);
        if (candidate.w > space.w || candidate.h > space.h || occupied.some(r => boxesOverlap(candidate, r))) continue;
        const d = pack ? candidate.y * a.view.width + candidate.x : (candidate.x - box.x) ** 2 + (candidate.y - box.y) ** 2;
        if (d < distance) { best = candidate; distance = d; }
      }
      if (best) return best;
    }
  }
  return null;
}

function inView(x: number, y: number, view: ViewSize, pad = 40): boolean {
  return x > -pad && y > -pad && x < view.width + pad && y < view.height + pad;
}

/** Радиус кольца старта, CSS-пиксели. */
const startRadius = (style: StyleDef) => css(style.marker.radius) * 1.5;

/** Старт — кольцо цвета линии на окантовке; не точка и не флаг, различимо и без цвета. */
function drawStart(a: TrackDrawArgs, x: number, y: number, label: string | null, below = false): void {
  const { ctx, style } = a;
  const R = startRadius(style);
  const w = Math.max(2, css(style.marker.ringWidth) * 1.6);
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = style.marker.fill;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  lineStyle(ctx, style.line.casing.color, w + 2.4);
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  lineStyle(ctx, style.line.color, w);
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
  // петля (финиш рядом со стартом): подпись старта уходит под маркер, подпись финиша остаётся над флагом
  if (label) drawLabel(a, label, x, below ? y + R + 6 + labelHeight(style) : y - R - 6, 1);
}

/** Высота древка флага финиша, CSS-пиксели. */
const FLAG_H = 30;

/** Финиш — флаг на древке с кольцом у основания: форма, а не только цвет. */
function drawFinish(a: TrackDrawArgs, x: number, y: number, label: string | null): void {
  const { ctx, style } = a;
  const casing = style.line.casing.color;
  const poleW = 2.2;
  const cw = 20, ch = 13; // полотнище
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // кольцо у основания
  lineStyle(ctx, casing, 4.6);
  ctx.beginPath(); ctx.arc(x, y, 4.4, 0, Math.PI * 2); ctx.stroke();
  lineStyle(ctx, style.line.color, 2);
  ctx.beginPath(); ctx.arc(x, y, 4.4, 0, Math.PI * 2); ctx.stroke();
  // древко
  lineStyle(ctx, casing, poleW + 2.4);
  ctx.beginPath(); ctx.moveTo(x, y - 4.4); ctx.lineTo(x, y - FLAG_H); ctx.stroke();
  lineStyle(ctx, style.palette.text, poleW);
  ctx.beginPath(); ctx.moveTo(x, y - 4.4); ctx.lineTo(x, y - FLAG_H); ctx.stroke();
  // полотнище с выемкой
  const top = y - FLAG_H;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(x + poleW / 2, top);
  ctx.lineTo(x + cw, top);
  ctx.lineTo(x + cw - 5, top + ch / 2);
  ctx.lineTo(x + cw, top + ch);
  ctx.lineTo(x + poleW / 2, top + ch);
  ctx.closePath();
  ctx.fillStyle = style.line.color;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = casing;
  ctx.stroke();
  ctx.restore();
  if (label) drawLabel(a, label, x, y - FLAG_H - 8, 1);
}

/** «Голова» маршрута: точка `fill` с кольцом `ring` (зазор `ringGap`), у «Неона» — мягкое свечение. Только от кадра. */
function drawHead(a: TrackDrawArgs, x: number, y: number): void {
  const { ctx, style } = a;
  const m = style.marker;
  const r = css(m.radius);
  const ringW = css(m.ringWidth);
  const ringR = r + css(m.ringGap) + ringW / 2;
  ctx.save();
  if (m.glow > 0) {
    const R = r * 4.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, style.line.glowColor);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = style.line.glowBlend;
    ctx.globalAlpha = 0.5 * m.glow;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  // кольцо на окантовке
  lineStyle(ctx, style.line.casing.color, ringW + 2.2);
  ctx.beginPath(); ctx.arc(x, y, ringR, 0, Math.PI * 2); ctx.stroke();
  lineStyle(ctx, m.ring, ringW);
  ctx.beginPath(); ctx.arc(x, y, ringR, 0, Math.PI * 2); ctx.stroke();
  // точка
  ctx.globalAlpha = 1;
  ctx.fillStyle = style.line.casing.color;
  ctx.beginPath(); ctx.arc(x, y, r + 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = m.fill;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Весь слой трека одного кадра: призрак → пройденная линия → остановки → старт → финиш → голова. Всё — от `frame`. */
export function drawTrackLayer(a: TrackDrawArgs): void {
  const { ctx, model: m, frame, style, view, route } = a;
  m.labelBoxes = [];
  if (m.n < 2) return;
  const L = style.line;
  const format = view.width < view.height ? '9:16' : '16:9';
  const width = css(L.width) * (frame.act === 'journey' ? 1 : layoutFor(format, style.id).readability.overviewLineScale);
  const cam = frame.camera;
  if (isWaypointRoute(route) && !route.waypointOrderConfirmed) {
    drawWaypointLayer({ ctx, route, frame, project: a.project, style, view });
    return;
  }

  // --- проекция только нужных точек
  const keep = visibleDisplay(m, mercX(cam.center[0]), mercY(cam.center[1]), cullRadius(frame, view), m.keep);
  const have = m.have; // что реально спроецировано в этом кадре
  have.fill(0);
  const projectTrack = isWaypointRoute(route) ? a.project : a.projectTrack ?? a.project;
  const attempted = new Uint8Array(m.n + 1);
  const project = (k: number) => {
    if (attempted[k]) return;
    attempted[k] = 1;
    const p = projectTrack(m.lon[k], m.lat[k]);
    if (!p) return;
    m.sx[k] = p.x; m.sy[k] = p.y; have[k] = 1;
  };

  const last = m.n - 1;
  const atEnd = frame.head >= route.points.length - 1 || frame.showFinish;
  const k = atEnd ? last : displayIndexAtHead(m, frame.head);
  const hasHeadSlot = !atEnd;
  const HEADSLOT = m.n; // слот «головы» в sx/sy
  if (hasHeadSlot) {
    const p = projectTrack(frame.headLonLat[0], frame.headLonLat[1]);
    if (p) { m.sx[HEADSLOT] = p.x; m.sy[HEADSLOT] = p.y; have[HEADSLOT] = 1; }
  }
  const want = (i: number) => keep[i] === 1;

  const lang = a.lang;
  const overviewLabels: { text: string; x: number; y: number; box: LabelBox }[] = [];
  if (isWaypointRoute(route) && frame.act !== 'journey') {
    const format = view.width < view.height ? '9:16' : '16:9';
    const obstacles = waypointOverviewObstacles(format, style).map(r => ({ x: css(r.x), y: css(r.y), w: css(r.w), h: css(r.h) }));
    ctx.save();
    const labels = ([[last, 'finish'], [0, 'start']] as const).map(([idx, kind]) => {
      const p = a.project(route.points[idx].lon, route.points[idx].lat);
      const beat = a.enrichment?.beats.find(b => b.kind === kind);
      const text = beatTitle(lang, { kind, idx, place: beat?.place, country: a.enrichment?.countryAt(idx) ?? undefined }, { near: true });
      return { text, x: p.x, y: p.y };
    });
    // Если первая плашка заняла единственный большой карман, переразмещаем обе
    // у границ свободных областей, а не возвращаем вторую на исходное препятствие.
    const minimum = css(format === '16:9' ? 24 : Math.min(style.type.kicker.size, style.type.secondary.size));
    const sizes = [css(style.type.label.size)];
    for (let size = css(style.type.label.size); size >= minimum; size--) sizes.push(size);
    for (const [attempt, size] of sizes.entries()) {
      overviewLabels.length = 0;
      const occupied = [...obstacles];
      for (const label of labels) {
        const box = placeWaypointLabel(a, label.text, label.x, label.y - startRadius(style) - 6, occupied, attempt > 0, size);
        if (!box) break;
        overviewLabels.push({ ...label, box }); occupied.push(box);
      }
      if (overviewLabels.length === labels.length) break;
    }
    ctx.restore();
    // Невместимый текст не должен молча превращаться в кадр с пересечением.
    if (overviewLabels.length !== labels.length) throw new Error('Waypoint labels cannot fit without overlapping frame obstacles');
  }
  if (isWaypointRoute(route)) {
    // маршрут по меткам: пунктирные соединения и метки по виду, а не сплошной GPS-трек (ADR 0010)
    drawWaypointLayer({ ctx, route, frame, project: a.project, style, view, labelObstacles: overviewLabels.map(l => l.box) });
  } else {
    const ghost = new PathBuilder(m.sx, m.sy);
    const done = new PathBuilder(m.sx, m.sy);
    const slot = (i: number) => (i === HEAD ? HEADSLOT : i);
    const add = (pb: PathBuilder, i: number, j: number, transfer: boolean) => {
      // Unknown path: hide the connection in every shot, including overviews.
      if (transfer) { pb.close(); return; }
      const iw = i === HEAD || want(i), jw = j === HEAD || want(j);
      if (!iw && !jw) { pb.close(); return; }
      if (i !== HEAD) project(i);
      if (j !== HEAD) project(j);
      if (!have[slot(i)] || !have[slot(j)]) { pb.close(); return; }
      pb.segment(slot(i), slot(j), transfer);
    };
    // пройденная часть: 0..k и отрезок k→голова (в интро голова стоит на старте — линии ещё нет)
    if (frame.act !== 'intro') {
      for (let s = 0; s < k; s++) add(done, s, s + 1, m.transferSeg[s] === 1);
      if (hasHeadSlot) add(done, k, HEAD, m.transferSeg[k] === 1);
    }
    done.close();
    // оставшаяся часть: голова→k+1 и дальше
    if (hasHeadSlot) {
      add(ghost, HEAD, k + 1, m.transferSeg[k] === 1);
      for (let s = k + 1; s < last; s++) add(ghost, s, s + 1, m.transferSeg[s] === 1);
    }
    ghost.close();

    const dash = [width * L.dash[0], width * L.dash[1]];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // непройденный остаток — тихий след на тонкой тёмной подложке (читается на снегу и песке); переезды в нём — тот же пунктир
    const ghostW = width * 0.6;
    lineStyle(ctx, L.ghostCasing, ghostW + 2.2);
    ctx.setLineDash([]);
    ctx.stroke(ghost.solid);
    lineStyle(ctx, L.ghost, ghostW);
    ctx.stroke(ghost.solid);
    ctx.setLineDash(dash);
    ctx.lineCap = 'butt';
    ctx.stroke(ghost.dash);
    ctx.lineCap = 'round';
    ctx.setLineDash([]);

    // окантовка отделяет линию от пёстрой подложки
    lineStyle(ctx, L.casing.color, width * L.casing.scale);
    ctx.stroke(done.solid);
    // одно узкое свечение: размытая тень самой линии (shadowBlur не зависит от трансформа — умножаем на его масштаб)
    if (L.glow > 0) {
      const scale = typeof ctx.getTransform === 'function' ? ctx.getTransform().a : 1;
      ctx.globalCompositeOperation = L.glowBlend;
      ctx.shadowColor = L.glowColor;
      ctx.shadowBlur = width * GLOW_SPREAD * scale * L.glow;
      lineStyle(ctx, L.glowColor, width, 0.9 * L.glow);
      ctx.stroke(done.solid);
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.globalCompositeOperation = 'source-over';
    }
    // основная линия и сердцевина
    lineStyle(ctx, L.color, width);
    ctx.stroke(done.solid);
    if (L.core !== L.color) {
      lineStyle(ctx, L.core, width * 0.38, 0.9);
      ctx.stroke(done.solid);
    }
    // переезды — пунктир
    lineStyle(ctx, L.gap, width * 0.9);
    ctx.setLineDash(dash);
    ctx.lineCap = 'butt';
    ctx.stroke(done.dash);
    ctx.setLineDash([]);
    ctx.restore();

    // Шевроны только на подтверждённой GPS-линии, только раскрытые звенья, никогда на разрывах.
    if (frame.shot && frame.act === 'journey') {
      ctx.save(); ctx.strokeStyle = L.core; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.85;
      let drawn = 0, spacing = 0;
      for (let s = 0; s < k && drawn < 16; s++) {
        if (m.transferSeg[s] || !m.have[s] || !m.have[s + 1]) continue;
        const dx = m.sx[s + 1] - m.sx[s], dy = m.sy[s + 1] - m.sy[s], len = Math.hypot(dx, dy);
        spacing += len;
        if (len < 12 || spacing < 70) continue;
        spacing = 0;
        const x = (m.sx[s] + m.sx[s + 1]) / 2, y = (m.sy[s] + m.sy[s + 1]) / 2;
        if (!inView(x, y, view, 0)) continue;
        const ux = dx / len, uy = dy / len;
        ctx.beginPath(); ctx.moveTo(x - ux * 4 - uy * 3, y - uy * 4 + ux * 3);
        ctx.lineTo(x + ux * 3, y + uy * 3); ctx.lineTo(x - ux * 4 + uy * 3, y - uy * 4 - ux * 3);
        ctx.stroke(); drawn++;
      }
      ctx.restore();
    }

    // --- остановки, которые голова уже прошла
    ctx.save();
    for (const w of route.waypoints) {
      if (w.idx > frame.head) continue;
      const p = a.project(w.lon, w.lat);
      if (!inView(p.x, p.y, view, 6)) continue;
      ctx.fillStyle = style.palette.accent;
      ctx.strokeStyle = style.palette.text;
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, css(style.marker.radius) * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  // --- старт и финиш
  const startBeat = a.enrichment?.beats.find((b) => b.kind === 'start');
  const finishBeat = a.enrichment?.beats.find((b) => b.kind === 'finish');
  const showLabels = frame.act !== 'journey';
  // у меток город у старта/финиша — только «рядом»: ближайший город к огрублённой метке не доказывает старт в нём
  const near = { near: isWaypointRoute(route) };
  const startText = showLabels && startBeat ? beatTitle(lang, startBeat, near) : null;
  const finishText = showLabels && frame.showFinish && finishBeat ?
    frame.shot && !isWaypointRoute(route) ? t(lang, 'film.end') : beatTitle(lang, finishBeat, near) : null;
  project(0);
  project(last);
  const startVisible = !!have[0] && inView(m.sx[0], m.sy[0], view);
  const finishVisible = frame.showFinish && !!have[last] && inView(m.sx[last], m.sy[last], view);
  if (isWaypointRoute(route) && showLabels) {
    // Крайние метки видны в обоих общих планах; их подписи зарезервированы до отрисовки пунктира.
    if (startVisible) drawStart(a, m.sx[0], m.sy[0], null);
    if (inView(m.sx[last], m.sy[last], view)) drawFinish(a, m.sx[last], m.sy[last], null);
    ctx.save();
    for (const { text, x, y, box } of overviewLabels) {
      const bx = clamp(x, box.x, box.x + box.w), by = clamp(y, box.y, box.y + box.h);
      ctx.strokeStyle = style.palette.accent; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(bx, by); ctx.stroke();
      drawLabel(a, text, x, y, 1, box);
    }
    ctx.restore();
    return;
  }
  // петля или короткий маршрут: подписи старта и финиша не должны наслаиваться — подпись старта уходит под маркер
  let startBelow = false;
  if (startText && finishText && startVisible && finishVisible) {
    ctx.save();
    const above = labelBox(a, startText, m.sx[0], m.sy[0] - startRadius(style) - 6);
    const fin = labelBox(a, finishText, m.sx[last], m.sy[last] - FLAG_H - 8);
    ctx.restore();
    startBelow = boxesOverlap(above, fin);
  }
  if (startVisible) drawStart(a, m.sx[0], m.sy[0], startText, startBelow);
  if (finishVisible) drawFinish(a, m.sx[last], m.sy[last], finishText);

  // --- голова
  const headIdx = Math.floor(frame.head);
  const inGap = !isWaypointRoute(route) && frame.head > headIdx &&
    (route.points[headIdx + 1]?.transferBefore || route.points[headIdx + 1]?.seg !== route.points[headIdx]?.seg);
  if (hasHeadSlot && have[HEADSLOT] && frame.act === 'journey' && !inGap) drawHead(a, m.sx[HEADSLOT], m.sy[HEADSLOT]);
}

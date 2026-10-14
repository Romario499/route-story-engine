// Слой «маршрут по меткам» на 2D-холсте поверх карты (ADR 0010, истории 141–142). Это не GPS-трек: метки соединены
// ПУНКТИРОМ, вид которого зависит от вида передвижения на участке, и ни один отрезок не рисуется сплошной линией трека.
//   уницикл (предположение) — длинный штрих цвета линии стиля;
//   поезд                   — частые точки цвета текста + значок поезда посреди длинного участка;
//   способ неизвестен       — тонкий серый штрих.
// Метки: ночёвка — лагерь (значок «палатка»), остановка — малая точка, жёлтая метка поезда — ромб/значок поезда.
// Всё — функция от кадра и данных (никакого состояния между кадрами); координаты — CSS-пиксели карты.
import { journeyFacts } from '../story/legs';
import type { FrameState, JourneyLeg, LegKind, Route, ViewSize } from '../types';
import { drawIcon } from './assets';
import type { StyleDef } from './styles';
import { waypointOverviewObstacles, type Rect } from './layout';

export type Project = (lon: number, lat: number) => { x: number; y: number };

export interface WaypointLayerArgs {
  ctx: CanvasRenderingContext2D;      // трансформ уже переведён в CSS-пиксели карты
  route: Route;
  frame: FrameState;
  project: Project;
  style: StyleDef;
  view: ViewSize;                     // MAP_VIEWPORT
  labelObstacles?: Rect[];            // обязательные подписи общего плана, CSS-пиксели
}

/** Дизайн-пиксели Full HD → CSS-пиксели карты. */
const css = (designPx: number) => designPx / 2;
const smoothstep = (x: number) => { const s = Math.max(0, Math.min(1, x)); return s * s * (3 - 2 * s); };

/** Шаг между соседними метками на экране (px), при котором значки меток уже читаются: ниже — точки, выше — значки. */
const GLYPH_SPACING_FROM = 9;
const GLYPH_SPACING_TO = 18;
/** Длина участка поезда на экране, с которой посреди него появляется значок поезда. */
const TRAIN_SIGN_FROM = 48;
const TRAIN_SIGN_TO = 80;
const CULL_PAD = 80;

type Seg = [number, number, number, number];
const KINDS: LegKind[] = ['unicycle', 'train', 'unknown'];

/** Интервал отрезка внутри прямоугольника: только обрезка, без изгибов или изменения географии. */
function insideInterval(seg: Seg, r: Rect, pad: number): [number, number] | null {
  let lo = 0, hi = 1;
  for (const [a, b, min, max] of [[seg[0], seg[2], r.x - pad, r.x + r.w + pad], [seg[1], seg[3], r.y - pad, r.y + r.h + pad]]) {
    const d = b - a;
    if (Math.abs(d) < 1e-9) { if (a < min || a > max) return null; continue; }
    const t0 = (min - a) / d, t1 = (max - a) / d;
    lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    if (lo > hi) return null;
  }
  return [lo, hi];
}

export const waypointLineIntersects = (seg: Seg, rect: Rect, pad = 5): boolean => insideInterval(seg, rect, pad) !== null;

function outsideSegments(seg: Seg, obstacles: Rect[], pad: number): Seg[] {
  let intervals: [number, number][] = [[0, 1]];
  for (const r of obstacles) {
    const inside = insideInterval(seg, r, pad);
    if (!inside) continue;
    intervals = intervals.flatMap(([a, b]) => {
      if (b <= inside[0] || a >= inside[1]) return [[a, b]];
      const out: [number, number][] = [];
      if (a < inside[0]) out.push([a, inside[0]]);
      if (b > inside[1]) out.push([inside[1], b]);
      return out;
    });
  }
  const point = (t: number): [number, number] => [seg[0] + (seg[2] - seg[0]) * t, seg[1] + (seg[3] - seg[1]) * t];
  return intervals.filter(([a, b]) => b - a > 1e-8).map(([a, b]) => [...point(a), ...point(b)] as Seg);
}

/** Цвет и штрих участка по виду передвижения: ни у одного нет пустого штриха, то есть сплошной линии. */
export interface LegLook { color: string; width: number; dash: number[]; cap: CanvasLineCap }
export function legLook(style: StyleDef, kind: LegKind): LegLook {
  const W = css(style.line.width);
  switch (kind) {
    case 'unicycle': return { color: style.line.color, width: W * 0.8, dash: [W * 2.4, W * 1.7], cap: 'butt' };
    case 'train': return { color: style.palette.text, width: W * 0.95, dash: [0.01, W * 1.9], cap: 'round' };
    case 'unknown': return { color: style.palette.secondary, width: W * 0.4, dash: [W * 1.2, W * 2], cap: 'butt' };
  }
}

function strokeSegments(ctx: CanvasRenderingContext2D, segs: Seg[]): void {
  if (!segs.length) return;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
  ctx.stroke();
}

function offscreen(x1: number, y1: number, x2: number, y2: number, view: ViewSize): boolean {
  return Math.max(x1, x2) < -CULL_PAD || Math.min(x1, x2) > view.width + CULL_PAD
    || Math.max(y1, y2) < -CULL_PAD || Math.min(y1, y2) > view.height + CULL_PAD;
}

const inView = (x: number, y: number, view: ViewSize, pad = 8) => x > -pad && y > -pad && x < view.width + pad && y < view.height + pad;

/** Значок на тёмной (у «Атласа» — светлой) подложке: читается на любом фоне. */
function badge(ctx: CanvasRenderingContext2D, style: StyleDef, x: number, y: number, R: number, ring: string, alpha: number): void {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = style.line.casing.color;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ring;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function median(values: number[]): number {
  if (!values.length) return Number.POSITIVE_INFINITY;
  const a = Float64Array.from(values).sort();
  return a[a.length >> 1];
}

export function drawWaypointLayer(a: WaypointLayerArgs): void {
  if (!a.route.waypointOrderConfirmed) {
    const { ctx, route, style, view } = a;
    ctx.save();
    ctx.fillStyle = style.line.color;
    for (const mark of route.journeyWaypoints ?? []) {
      const p = a.project(mark.lon, mark.lat);
      if (!inView(p.x, p.y, view)) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, css(style.marker.radius) * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return;
  }
  const { ctx, route, frame, style, view } = a;
  const facts = journeyFacts(route);
  const marks = route.journeyWaypoints;
  if (!facts || !marks || marks.length < 2) return;
  const n = marks.length, last = n - 1;
  const L = style.line;

  const x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) { const p = a.project(marks[i].lon, marks[i].lat); x[i] = p.x; y[i] = p.y; }
  const head = a.project(frame.headLonLat[0], frame.headLonLat[1]);

  // сколько пройдено: интро — ничего; финал и голова на последней метке — всё; иначе целые участки до головы и кусок текущего
  const done = frame.act === 'intro' ? -1 : (frame.act === 'outro' || frame.head >= last) ? last : Math.floor(frame.head);
  const fraction = done >= 0 && done < last;
  const passedMark = (i: number) => done >= 0 && (i <= done);

  const passed: Record<LegKind, Seg[]> = { unicycle: [], train: [], unknown: [] };
  const ghost: Record<LegKind, Seg[]> = { unicycle: [], train: [], unknown: [] };
  const obstacles = frame.act === 'journey' ? [] : waypointOverviewObstacles(view.width < view.height ? '9:16' : '16:9', style)
    .map(r => ({ x: css(r.x), y: css(r.y), w: css(r.w), h: css(r.h) }));
  obstacles.push(...(a.labelObstacles ?? []));
  const add = (list: Seg[], x1: number, y1: number, x2: number, y2: number) => {
    if (!offscreen(x1, y1, x2, y2, view)) list.push(...outsideSegments([x1, y1, x2, y2], obstacles, css(style.line.width) + 6));
  };
  facts.legs.forEach((leg: JourneyLeg, i) => {
    const x1 = x[i], y1 = y[i], x2 = x[i + 1], y2 = y[i + 1];
    if (done >= 0 && i < done) add(passed[leg.kind], x1, y1, x2, y2);
    else if (fraction && i === done) { add(passed[leg.kind], x1, y1, head.x, head.y); add(ghost[leg.kind], head.x, head.y, x2, y2); }
    else add(ghost[leg.kind], x1, y1, x2, y2);
  });

  ctx.save();
  ctx.lineJoin = 'round';

  // --- соединения: непройденные — тихий след, пройденные — яркие; все пунктиром
  for (const kind of KINDS) {
    const look = legLook(style, kind);
    const ghostW = Math.max(1, look.width * 0.7);
    ctx.setLineDash(look.dash);
    ctx.lineCap = look.cap;
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = L.ghostCasing;
    ctx.lineWidth = ghostW + 1.8;
    strokeSegments(ctx, ghost[kind]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = L.ghost;
    ctx.lineWidth = ghostW;
    strokeSegments(ctx, ghost[kind]);
  }
  for (const kind of KINDS) {
    const look = legLook(style, kind);
    ctx.setLineDash(look.dash);
    ctx.lineCap = look.cap;
    if (kind !== 'unknown') {
      ctx.globalAlpha = 1;
      ctx.strokeStyle = L.casing.color;
      ctx.lineWidth = look.width + 2.4;
      strokeSegments(ctx, passed[kind]);
    }
    ctx.globalAlpha = kind === 'unknown' ? 0.85 : 1;
    ctx.strokeStyle = look.color;
    ctx.lineWidth = look.width;
    strokeSegments(ctx, passed[kind]);
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // --- насколько плотно метки на экране: плотные — точки, редкие — значки
  const gaps: number[] = [];
  for (let i = 0; i < last; i++) if (inView(x[i], y[i], view, 0) && inView(x[i + 1], y[i + 1], view, 0)) gaps.push(Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i]));
  const glyph = smoothstep((median(gaps) - GLYPH_SPACING_FROM) / (GLYPH_SPACING_TO - GLYPH_SPACING_FROM));

  // --- метки: ещё не пройденные — едва заметные точки; пройденные — по виду метки (старт и финиш рисует track.ts)
  // Разрежаем также точки в интро: их плотность не должна зависеть от медианы всей цепочки.
  // Важные метки резервируют место раньше обычных ночёвок (даже будущие), поэтому они не исчезают.
  const spacing = Math.max(view.width < view.height ? 16 : 18, css(style.marker.radius) * 2.1 + 2);
  const important = new Set([0, last, ...facts.runs.slice(1).map((run) => run.fromIdx)]);
  for (let i = 0; i < n; i++) if (marks[i].kind !== 'overnight') important.add(i);
  const iconR = css(style.marker.radius) * 0.98 + 0.6;
  const occupied = [...important].filter((i) => inView(x[i], y[i], view)).map((i) => ({ x: x[i], y: y[i], r: i === 0 ? css(style.marker.radius) * 1.5 + 2 : iconR }));
  // У финиша полотнище поднято над координатой.
  if (inView(x[last], y[last], view)) occupied.push({ x: x[last] + 10, y: y[last] - 15, r: 21 });
  // Поезда на длинных участках также защищены от пересечения с ночёвками.
  facts.legs.forEach((leg, i) => { if (leg.kind === 'train' && i < done && Math.hypot(x[i+1]-x[i],y[i+1]-y[i]) > TRAIN_SIGN_FROM) occupied.push({x:(x[i]+x[i+1])/2,y:(y[i]+y[i+1])/2,r:css(style.marker.radius)*1.45+0.6}); });
  const visible = new Set(important);
  for (let i = 1; i < last; i++) {
    if (important.has(i) || !inView(x[i], y[i], view)) continue;
    if (occupied.some((p) => Math.hypot(x[i] - p.x, y[i] - p.y) < Math.max(spacing, iconR + p.r + 2))) continue;
    visible.add(i); occupied.push({ x: x[i], y: y[i], r: iconR });
  }
  const dotR = css(style.marker.radius) * 0.42;
  for (let i = 1; i < last; i++) {
    if (!visible.has(i) || passedMark(i) || !inView(x[i], y[i], view)) continue;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = L.ghost;
    ctx.beginPath(); ctx.arc(x[i], y[i], dotR * 0.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (let i = 1; i < last; i++) {
    if (!visible.has(i) || !passedMark(i) || !inView(x[i], y[i], view)) continue;
    const kind = marks[i].kind;
    const px = x[i], py = y[i];
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = L.casing.color;
    ctx.fillStyle = kind === 'overnight' ? L.color : style.palette.text;
    if (kind === 'train') {
      ctx.beginPath(); ctx.moveTo(px, py - dotR * 1.5); ctx.lineTo(px + dotR * 1.5, py); ctx.lineTo(px, py + dotR * 1.5); ctx.lineTo(px - dotR * 1.5, py); ctx.closePath();
      ctx.stroke(); ctx.fill();
    } else if (kind === 'unknown') {
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.arc(px, py, dotR, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = style.palette.secondary;
      ctx.beginPath(); ctx.arc(px, py, dotR, 0, Math.PI * 2); ctx.stroke();
    } else {
      const r = kind === 'stop' ? dotR * 0.62 : dotR;
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    }
    if (glyph > 0.02 && (kind === 'overnight' || kind === 'train')) {
      const ring = kind === 'overnight' ? L.color : style.palette.text;
      badge(ctx, style, px, py, css(style.marker.radius) * 0.98, ring, glyph);
      ctx.save();
      ctx.globalAlpha *= glyph;
      drawIcon(ctx, kind === 'overnight' ? 'tent' : 'train', px, py, css(style.marker.radius) * 1.45, ring);
      ctx.restore();
    }
  }

  // --- значок поезда посреди длинного пройденного участка поезда (смена линии и значка — смена транспорта)
  if (done > 0) {
    facts.legs.forEach((leg, i) => {
      if (leg.kind !== 'train' || i >= done) return;
      const len = Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i]);
      const k = smoothstep((len - TRAIN_SIGN_FROM) / (TRAIN_SIGN_TO - TRAIN_SIGN_FROM));
      const mx = (x[i] + x[i + 1]) / 2, my = (y[i] + y[i + 1]) / 2;
      if (k <= 0.02 || !inView(mx, my, view)) return;
      badge(ctx, style, mx, my, css(style.marker.radius) * 1.45, style.palette.text, k);
      ctx.save();
      ctx.globalAlpha *= k;
      drawIcon(ctx, 'train', mx, my, css(style.marker.radius) * 2.1, style.palette.text);
      ctx.restore();
    });
  }
  ctx.restore();
}

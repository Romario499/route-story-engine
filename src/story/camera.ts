// Камера: общий план, зум путешествия по размаху маршрута, сглаженный путь «чуть впереди головы»,
// переходы «нырок» (интро) и «отъезд» (финал). Всё в Web Mercator; путь путешествия предвычислен.
import type { CameraState, Route, ViewSize } from '../types';
import { fitBounds, latOf, lonOf, mercPerMeter, mercX, mercY, TILE_SIZE, type Padding } from './mercator';

/** Частота предвычисленных отсчётов камеры путешествия. */
const CAM_HZ = 60;
/**
 * Центр камеры — путь, сглаженный ВДОЛЬ МАРШРУТА (в метрах, а не во времени): σ и упреждение заданы
 * долей кадра путешествия, поэтому на любой скорости голова остаётся у центра, а шум GPS и мелкие петли
 * серпантина гасятся. У концов маршрута окно сужается симметрично — путь начинается в старте и кончается в финише.
 */
const CENTER_SIGMA_VIEW_SHARE = 0.15;
const CENTER_LEAD_VIEW_SHARE = 0.12;
/** Предел отсчётов сетки сглаживания пути. */
const PATH_GRID_MAX = 40_000;
/** Сглаживание зума. */
const ZOOM_SIGMA_SEC = 0.5;
/** Наезд на битах (в уровнях зума) и его полуширина по времени. */
const BEAT_PUSH_ZOOM = 0.35;
const BEAT_PUSH_HALF_SEC = 1.0;
/** Отступ общего плана — доля меньшей стороны кадра. */
const OVERVIEW_PADDING_SHARE = 0.1;
const OVERVIEW_MAX_ZOOM = 16;
const JOURNEY_MAX_ZOOM = 16.5;
/** Ширина «окна путешествия» (м по меньшей стороне кадра) от размаха S: V = 2,5·S^0,79 → 8 000 км ≈ 600 км, 10 км ≈ 3,6 км. */
const VIEW_K = 2.5;
const VIEW_P = 0.79;
const VIEW_MAX_SHARE = 0.6;
const VIEW_MIN_M = 400;
/** В кадре — не меньше, чем голова проходит за столько секунд: иначе фон мелькает. */
const VIEW_MIN_TRAVEL_SEC = 1.0;
/** Метки не требуют уличного масштаба или DEM; глава раскрывает регион ~400 км. */
const WAYPOINT_MAX_ZOOM = 8;
const CHAPTER_VIEW_M = 400_000;
export const WAYPOINT_ZOOM_SPEED = 0.6;
export const CAMERA_AVERAGE_RADIUS = 0.25;

/** Separate cubic for waypoint camera windows; the GPX smootherstep stays unchanged. */
export const cameraCubic = (u: number): number => {
  const x = Math.max(0, Math.min(1, u));
  return x * x * (3 - 2 * x);
};

export interface ChapterCameraWindow { start: number; plateauStart: number; plateauEnd: number; end: number; amplitude: number }

/** Merge reading windows before assigning ramps. Camera amplitude yields to available time, never reading. */
export function planChapterCamera(windows: { start: number; end: number }[], from: number, to: number,
  baseZoom: number, chapterZoom: number): ChapterCameraWindow[] {
  const amplitude = Math.max(0, Math.min(2, chapterZoom - baseZoom));
  const ramp = 1.5 * amplitude / WAYPOINT_ZOOM_SPEED;
  const groups: { start: number; end: number }[] = [];
  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    const prev = groups[groups.length - 1];
    if (prev && (w.start - prev.end < 2 || prev.end + ramp >= w.start - ramp)) prev.end = Math.max(prev.end, w.end);
    else groups.push({ ...w });
  }
  return groups.map((g, i) => {
    const lo = i ? (groups[i - 1].end + g.start) / 2 : from;
    const hi = i + 1 < groups.length ? (g.end + groups[i + 1].start) / 2 : to;
    // H includes the entire reading plateau and 0.5 s for the final moving average.
    const plateauStart = g.start - CAMERA_AVERAGE_RADIUS, plateauEnd = g.end + CAMERA_AVERAGE_RADIUS;
    const a = Math.max(0, Math.min(amplitude, WAYPOINT_ZOOM_SPEED * (hi - lo - (plateauEnd - plateauStart)) / 3,
      WAYPOINT_ZOOM_SPEED * (plateauStart - lo) / 1.5, WAYPOINT_ZOOM_SPEED * (hi - plateauEnd) / 1.5));
    const r = 1.5 * a / WAYPOINT_ZOOM_SPEED;
    return { start: plateauStart - r, plateauStart, plateauEnd, end: plateauEnd + r, amplitude: a };
  });
}

export function chapterCameraWeight(t: number, w: ChapterCameraWindow): number {
  if (!(w.amplitude > 0) || t <= w.start || t >= w.end) return 0;
  if (t < w.plateauStart) return cameraCubic((t - w.start) / (w.plateauStart - w.start));
  if (t <= w.plateauEnd) return 1;
  return cameraCubic((w.end - t) / (w.end - w.plateauEnd));
}

/** Exact integral of a linear interpolant, with constant extension at both ends. C1 even at sample knots. */
export function averagedSamples(values: Float64Array, h: number, radius = CAMERA_AVERAGE_RADIUS): (t: number) => number {
  const last = values.length - 1, end = last * h, origin = values[0];
  const areas = new Float64Array(values.length);
  for (let i = 1; i <= last; i++) areas[i] = areas[i - 1] + ((values[i - 1] - origin) + (values[i] - origin)) * h / 2;
  const integral = (t: number): number => {
    if (t <= 0) return 0;
    if (t >= end) return areas[last] + (t - end) * (values[last] - origin);
    const i = Math.min(last - 1, Math.floor(t / h)), d = t - i * h;
    return areas[i] + (values[i] - origin) * d + (values[i + 1] - values[i]) * d * d / (2 * h);
  };
  return t => origin + (integral(t + radius) - integral(t - radius)) / (2 * radius);
}

/** Whole-film zoom, after every raw contribution (beats, chapters, dive and pullback).
 * Both passes make L 0.6-Lipschitz. Z'= (L(t+r)-L(t-r))/(2r), hence |Z'|<=0.6 everywhere.
 * L is continuous, so Z is C1. No previous-frame state and no post-filter zoom additions.
 */
export function planWaypointZoom(rawZoom: (t: number) => number, duration: number, journeyEnd: number,
  overviewZoom: number, maxZoom: number,
  plateaus: { start: number; end: number; zoom: number }[] = [],
  ceilingAt: (t: number) => number = () => Infinity): (t: number) => number {
  const count = Math.ceil(duration * CAM_HZ), h = duration / count;
  // Anticipate reading before either speed-limiting pass. The lower envelope is
  // itself 0.6-Lipschitz, so limiting cannot erase a feasible reading plateau.
  // Include both this average and the final center planner's zoom average.
  const guard = CAMERA_AVERAGE_RADIUS + 3 * h;
  const q = Float64Array.from({ length: count + 1 }, (_, i) => {
    const t = i * h;
    const floor = plateaus.reduce((z, w) => Math.max(z, Math.min(maxZoom, w.zoom)
      - WAYPOINT_ZOOM_SPEED * Math.max(0, w.start - guard - t, t - w.end - guard)), overviewZoom);
    return t <= CAMERA_AVERAGE_RADIUS || t >= journeyEnd - CAMERA_AVERAGE_RADIUS
      ? overviewZoom : Math.min(ceilingAt(t), Math.max(floor, Math.min(maxZoom, rawZoom(t))));
  });
  for (let i = 1; i <= count; i++) q[i] = Math.min(q[i], q[i - 1] + WAYPOINT_ZOOM_SPEED * h);
  for (let i = count - 1; i >= 0; i--) q[i] = Math.min(q[i], q[i + 1] + WAYPOINT_ZOOM_SPEED * h);
  return averagedSamples(q, h);
}

export interface Mcam { x: number; y: number; zoom: number; pitch: number; bearing?: number }

/** Limit the final center vector after zoom, smoothing and HUD displacement.
 * The backward pass anticipates transfers. Bounds invert the scene's pitched flat
 * projection, with room for the marker and DEM, rather than correcting a rendered frame. */
export function planWaypointCenter(desired: (t: number) => Mcam, headAt: (t: number) => [number, number],
  duration: number, introEnd: number, journeyEnd: number, viewport: ViewSize, padding: Padding | undefined,
  maxPitch: number, overview: Mcam, chapterAt: (t: number) => boolean = () => false,
  readingWindows: { start: number; end: number }[] = []): (t: number) => Mcam {
  const h = 1 / CAM_HZ, count = Math.round(duration * CAM_HZ) + 1;
  const raw = Array.from({ length: count }, (_, i) => desired(i * h));
  const heads = Array.from({ length: count }, (_, i) => headAt(i * h));
  // First widen the view around fast travel, before changing the desired center.
  // planWaypointZoom propagates these caps in both directions at <=0.6 levels/s.
  const zoomCaps = raw.map((c, i) => {
    let speed = 0;
    for (const j of [i - 1, i + 1]) if (raw[j]) speed = Math.max(speed,
      Math.hypot((c.x - raw[j].x) / viewport.width, (c.y - raw[j].y) / viewport.height) * TILE_SIZE * 2 ** c.zoom / h);
    return c.zoom + Math.min(0, Math.log2(0.285 / Math.max(1e-12, speed)));
  });
  const cappedZoom = (t: number) => {
    const q = Math.max(0, Math.min(count - 1, t * CAM_HZ)), i = Math.min(count - 2, Math.floor(q));
    return zoomCaps[i] + (zoomCaps[i + 1] - zoomCaps[i]) * (q - i);
  };
  const wide = viewport.width > viewport.height;
  const margin = 18; // CSS px: marker radius + terrain projection allowance.
  const safe = { left: Math.max(padding?.left ?? 0, viewport.width * (wide ? 0.04 : 0)) + margin,
    right: Math.min(viewport.width - (padding?.right ?? 0), viewport.width * (wide ? 0.96 : 0.88)) - margin,
    top: Math.max(padding?.top ?? 0, viewport.height * (wide ? 0.05 : 0.12)) + margin,
    bottom: Math.min(viewport.height - (padding?.bottom ?? 0), viewport.height * (wide ? 0.935 : 0.8)) - margin };
  let result: Mcam[] = raw;
  const reading = readingWindows.map(w => ({ ...w, zoom: overview.zoom + 1.5001 }));
  // Only a failed center constraint may override reading or optional amplitude.
  // The two Lipschitz passes propagate a local cap as far as the zoom speed needs,
  // preserving the original peaks and complete reading windows everywhere else.
  const ceilings = new Float64Array(count).fill(Infinity);
  const ceilingAt = (t: number) => ceilings[Math.max(0, Math.min(count - 1, Math.round(t / h)))];
  for (let attempt = 0; attempt <= 24; attempt++) {
    const zoomAt = planWaypointZoom(cappedZoom, duration, journeyEnd, overview.zoom, 8, reading, ceilingAt);
    const samples = raw.map((c, i) => ({ ...c, zoom: zoomAt(i * h) }));
    const bounds = samples.map((c, i) => {
      if (i * h < introEnd || i * h >= journeyEnd) return null;
      const world = TILE_SIZE * 2 ** c.zoom;
      const pitch = Math.min(28, c.pitch * maxPitch) * Math.PI / 180;
      const D = 1.5 * viewport.height, sin = Math.sin(pitch), cos = Math.cos(pitch);
      const invertY = (screen: number) => { const y = screen - viewport.height / 2; return y * D / (D * cos + y * sin); };
      const chapter = chapterAt(i * h);
      const bottom = !wide && chapter ? Math.min(safe.bottom, viewport.height * 0.5 - margin) : safe.bottom;
      // Country + two title/text lines + geography legend remain above the head.
      const top = chapter ? Math.max(safe.top, viewport.height * (wide ? 0.55 : 0.38) + margin) : safe.top;
      const y0 = invertY(top), y1 = invertY(bottom);
      const scale = Math.max(D / (D - y0 * sin), D / (D - y1 * sin));
      const right = wide && chapter ? Math.min(safe.right, viewport.width * 0.6 - margin) : safe.right;
      const x0 = (safe.left - viewport.width / 2) / scale, x1 = (right - viewport.width / 2) / scale;
      return { x0: heads[i][0] - x1 / world, x1: heads[i][0] - x0 / world,
        y0: heads[i][1] - y1 / world, y1: heads[i][1] - y0 / world };
    });
    // The averaging window at t=0 must contain only overview samples: frameAt
    // clamps negative time, so a nonzero endpoint derivative would break C1 there.
    const pin = (i: number) => i <= 4 || i * h >= journeyEnd;
    const project = (i: number) => {
      const b = bounds[i], c = samples[i];
      if (pin(i)) { c.x = overview.x; c.y = overview.y; }
      else if (b) { c.x = Math.max(b.x0, Math.min(b.x1, c.x)); c.y = Math.max(b.y0, Math.min(b.y1, c.y)); }
    };
    // Slightly below the acceptance ceiling for interpolation and varying zoom.
    const radius = (i: number, j: number) => 0.285 * h / (TILE_SIZE * 2 ** Math.max(samples[i].zoom, samples[j].zoom));
    const limit = (i: number, j: number) => {
      const a = samples[i], b = samples[j];
      const dx = (a.x - b.x) / viewport.width, dy = (a.y - b.y) / viewport.height;
      const length = Math.hypot(dx, dy), r = radius(i, j);
      if (length > r && !pin(i)) { a.x = b.x + dx * r / length * viewport.width; a.y = b.y + dy * r / length * viewport.height; }
      project(i);
    };
    samples.forEach((_, i) => project(i));
    let valid = false;
    for (let pass = 0; pass < 400; pass++) {
      for (let i = 1; i < count; i++) limit(i, i - 1);
      for (let i = count - 2; i >= 0; i--) limit(i, i + 1);
      valid = samples.every((c, i) => i === 0 || Math.hypot((c.x - samples[i - 1].x) / viewport.width,
        (c.y - samples[i - 1].y) / viewport.height) <= radius(i, i - 1) * (1 + 1e-7));
      if (valid) break;
    }
    result = samples;
    if (valid) break;
    if (attempt === 24) throw new RangeError('Waypoint center and safe-area constraints are infeasible');
    // Relax only the unresolved links, never every chapter because one transfer
    // failed. Zoom at the overview is already feasible for these route bounds.
    for (let i = 1; i < count; i++) {
      const c = samples[i], p = samples[i - 1];
      if (Math.hypot((c.x - p.x) / viewport.width, (c.y - p.y) / viewport.height)
        <= radius(i, i - 1) * (1 + 1e-7)) continue;
      const cap = Math.max(overview.zoom, Math.max(c.zoom, p.zoom) - 0.125);
      ceilings[i] = Math.min(ceilings[i], cap);
      ceilings[i - 1] = Math.min(ceilings[i - 1], cap);
    }
  }
  // Four samples soften the safe-area entry's acceleration as well as its speed.
  // At the 0.285 viewport/s limit, the mean displacement stays within the 18 px margin.
  const centerX = averagedSamples(Float64Array.from(result, c => c.x), h, h * 4);
  const centerY = averagedSamples(Float64Array.from(result, c => c.y), h, h * 4);
  const finalZoom = averagedSamples(Float64Array.from(result, c => c.zoom), h, h * 2);
  return t => {
    const q = Math.max(0, Math.min(count - 1, t * CAM_HZ)), i = Math.min(count - 2, Math.floor(q)), f = q - i;
    const a = result[i], b = result[i + 1];
    return { x: centerX(t), y: centerY(t), zoom: finalZoom(t), pitch: a.pitch + (b.pitch - a.pitch) * f };
  };
}

export const toCamera = (c: Mcam): CameraState => ({ center: [lonOf(c.x), latOf(c.y)], zoom: c.zoom, pitch: c.pitch, bearing: c.bearing ?? 0 });

export function overviewCamera(route: Route, viewport: ViewSize, padding?: Padding): Mcam {
  const pad = padding ?? Math.round(OVERVIEW_PADDING_SHARE * Math.min(viewport.width, viewport.height));
  const { center, zoom } = fitBounds(route.bbox, viewport, pad);
  return { x: mercX(center[0]), y: mercY(center[1]), zoom: Math.min(route.source?.kind === 'waypoints' ? WAYPOINT_MAX_ZOOM : OVERVIEW_MAX_ZOOM, zoom), pitch: 0 };
}

/** Региональный план главы, без зависимости от темпа чтения и условной скорости меток. */
export function waypointChapterZoom(route: Route, viewport: ViewSize): number {
  const midLat = (route.bbox[1] + route.bbox[3]) / 2;
  return Math.min(WAYPOINT_MAX_ZOOM, Math.log2(Math.min(viewport.width, viewport.height) / TILE_SIZE / (CHAPTER_VIEW_M * mercPerMeter(midLat))));
}

/** Размах маршрута — диагональ bbox, м. */
function spanM(route: Route): number {
  const [a, b, c, d] = route.bbox;
  const midLat = ((b + d) / 2) * (Math.PI / 180);
  return Math.hypot((c - a) * 111_320 * Math.cos(midLat), (d - b) * 110_574);
}

/** Ширина «окна путешествия» в метрах по меньшей стороне кадра: от размаха маршрута и скорости головы. */
export function journeyViewM(route: Route, cruiseMps: number): number {
  const S = spanM(route);
  let V = VIEW_K * Math.pow(Math.max(1, S), VIEW_P);
  V = Math.max(V, VIEW_MIN_TRAVEL_SEC * cruiseMps);
  V = Math.min(V, VIEW_MAX_SHARE * S);
  return Math.max(V, VIEW_MIN_M);
}

/** Базовый зум путешествия: в кадре заметный кусок маршрута, а не вся страна и не одна улица. */
export function journeyZoom(route: Route, viewport: ViewSize, cruiseMps: number, overviewZoom: number): number {
  const V = journeyViewM(route, cruiseMps);
  const midLat = (route.bbox[1] + route.bbox[3]) / 2;
  const minDim = Math.min(viewport.width, viewport.height);
  const z = Math.log2(minDim / TILE_SIZE / (V * mercPerMeter(midLat)));
  return Math.max(overviewZoom + 0.6, Math.min(JOURNEY_MAX_ZOOM, z));
}

/** Гауссово сглаживание отсчётов по времени (для зума), окно обрезается краями и перенормируется. */
function smooth(src: Float64Array, hz: number, sigmaSec: number, leadSec: number): Float64Array {
  const K = src.length;
  const out = new Float64Array(K);
  const sigma = sigmaSec * hz;
  const lead = leadSec * hz;
  const half = Math.ceil(3 * sigma);
  const weights = new Float64Array(2 * half + 1);
  for (let k = -half; k <= half; k++) weights[k + half] = Math.exp(-0.5 * (k / sigma) ** 2);
  for (let j = 0; j < K; j++) {
    const c = j + lead;
    const from = Math.max(0, Math.ceil(c - half));
    const to = Math.min(K - 1, Math.floor(c + half));
    let s = 0, ws = 0;
    for (let i = from; i <= to; i++) {
      const wi = weights[Math.min(2 * half, Math.max(0, Math.round(i - c) + half))];
      s += src[i] * wi; ws += wi;
    }
    out[j] = ws > 0 ? s / ws : src[Math.min(K - 1, Math.max(0, Math.round(c)))];
  }
  return out;
}

export interface JourneyCameraInput {
  route: Route;
  viewport: ViewSize;
  journeySec: number;
  baseZoom: number;
  /** Дробный индекс головы через τ секунд путешествия. */
  headIdxAt(tau: number): number;
  /** Моменты битов (с начала путешествия) — на них лёгкий наезд. */
  beatTimes: number[];
  /** Окна чтения глав, секунды от начала путешествия; только для меток. */
  chapterWindows?: { start: number; end: number }[];
  chapterZoom?: number;
  chapterCameraBounds?: { from: number; to: number };
  /**
   * Куда на экране ставить цель камеры относительно центра кадра, CSS-пиксели (центр свободной от HUD области
   * минус центр кадра). Сдвиг плоский, без поправки на наклон: при pitch голова смещается по вертикали чуть меньше.
   */
  shiftPx?: { x: number; y: number };
}

const smoothLead = (x: number): number => { const s = Math.max(0, Math.min(1, x)); return s * s * (3 - 2 * s); };

/** Метры вдоль маршрута в дробном индексе. */
function dAtHead(route: Route, head: number): number {
  const pts = route.points;
  const last = pts.length - 1;
  if (head >= last) return pts[last].d;
  const i = Math.max(0, Math.floor(head));
  return pts[i].d + (pts[i + 1].d - pts[i].d) * (head - i);
}

/**
 * Сглаженный путь как функция метров вдоль маршрута: равномерная сетка по d, гаусс с σ(s) = min(σ, s, D − s)
 * (у концов окно сужается симметрично, поэтому путь начинается ровно в старте и кончается в финише).
 */
function smoothPath(route: Route, sigmaM: number): (s: number) => [number, number] {
  const pts = route.points;
  const last = pts.length - 1;
  const total = pts[last].d;
  if (!(total > 0) || !(sigmaM > 0)) {
    const x = mercX(pts[0].lon), y = mercY(pts[0].lat);
    return () => [x, y];
  }
  const M = Math.min(PATH_GRID_MAX, Math.max(2, Math.ceil((total / sigmaM) * 6) + 1));
  const h = total / (M - 1);
  const rx = new Float64Array(M), ry = new Float64Array(M);
  let i = 0;
  for (let k = 0; k < M; k++) {
    const s = k * h;
    while (i < last - 1 && pts[i + 1].d < s) i++;
    const a = pts[i], b = pts[Math.min(last, i + 1)];
    const span = b.d - a.d;
    const f = span > 0 ? Math.max(0, Math.min(1, (s - a.d) / span)) : 0;
    rx[k] = mercX(a.lon + (b.lon - a.lon) * f);
    ry[k] = mercY(a.lat + (b.lat - a.lat) * f);
  }
  const sx = new Float64Array(M), sy = new Float64Array(M);
  const sigmaK = sigmaM / h;
  for (let k = 0; k < M; k++) {
    const sg = Math.min(sigmaK, k, M - 1 - k);
    if (sg < 0.5) { sx[k] = rx[k]; sy[k] = ry[k]; continue; }
    const half = Math.min(Math.ceil(3 * sg), k, M - 1 - k);
    let wx = 0, wy = 0, ws = 0;
    for (let q = -half; q <= half; q++) {
      const w = Math.exp(-0.5 * (q / sg) ** 2);
      wx += rx[k + q] * w; wy += ry[k + q] * w; ws += w;
    }
    sx[k] = wx / ws; sy[k] = wy / ws;
  }
  return (s: number) => {
    const p = Math.max(0, Math.min(M - 1, s / h));
    const k = Math.min(M - 2, Math.floor(p));
    const f = p - k;
    return [sx[k] + (sx[k + 1] - sx[k]) * f, sy[k] + (sy[k + 1] - sy[k]) * f];
  };
}

/** Предвычисленный путь камеры путешествия; at(τ) — линейная интерполяция отсчётов. */
export function journeyCamera(inp: JourneyCameraInput): { at(tau: number): Mcam; chapterWindows: ChapterCameraWindow[] } {
  const { route, journeySec, baseZoom } = inp;
  const K = Math.max(2, Math.ceil(journeySec * CAM_HZ) + 1);
  const dt = journeySec / (K - 1);
  const hz = 1 / dt;
  const xs = new Float64Array(K), ys = new Float64Array(K), zs = new Float64Array(K);

  // ширина кадра путешествия в метрах — от неё σ и упреждение центра
  const minDim = Math.min(inp.viewport.width, inp.viewport.height);
  const midLat = (route.bbox[1] + route.bbox[3]) / 2;
  const viewM = minDim / TILE_SIZE / 2 ** baseZoom / mercPerMeter(midLat);
  const path = smoothPath(route, CENTER_SIGMA_VIEW_SHARE * viewM);
  const leadM = CENTER_LEAD_VIEW_SHARE * viewM;
  const totalM = route.points[route.points.length - 1].d;
  const chapterZoom = inp.chapterZoom ?? baseZoom;
  const chapterViewM = minDim / TILE_SIZE / 2 ** chapterZoom / mercPerMeter(midLat);
  const chapterPath = inp.chapterWindows?.length ? smoothPath(route, CENTER_SIGMA_VIEW_SHARE * chapterViewM) : null;
  const chapterLeadM = CENTER_LEAD_VIEW_SHARE * chapterViewM;
  const chapterWindows = planChapterCamera(inp.chapterWindows ?? [], inp.chapterCameraBounds?.from ?? 0,
    inp.chapterCameraBounds?.to ?? journeySec, baseZoom, chapterZoom);

  // переезды: камера чуть поднимается, если прыжок длиннее окна кадра
  const lifts = route.transfers.map(({ fromIdx, toIdx }) => {
    const len = route.points[toIdx].d - route.points[fromIdx].d;
    return { fromIdx, toIdx, lift: Math.max(0, Math.min(1.5, Math.log2(len / viewM))) };
  });

  for (let j = 0; j < K; j++) {
    const tau = j * dt;
    const h = inp.headIdxAt(tau);
    const d = dAtHead(route, h);
    // упреждение гаснет на последних 4·leadM пути: цель камеры подходит к финишу плавно, а не упирается в него на полном ходу
    const lead = leadM > 0 ? leadM * smoothLead((totalM - d) / (4 * leadM)) : 0;
    const [x, y] = path(Math.min(totalM, d + lead));
    xs[j] = x; ys[j] = y;
    let push = 0;
    for (const tb of inp.beatTimes) {
      const z = Math.abs(tau - tb) / BEAT_PUSH_HALF_SEC;
      if (z < 1) push = Math.max(push, 1 - z * z * (3 - 2 * z));
    }
    let lift = 0;
    for (const l of lifts) if (h > l.fromIdx && h < l.toIdx) lift = Math.max(lift, l.lift);
    let chapterWeight = 0;
    let chapterAmplitude = 0;
    for (const slot of chapterWindows) {
      const weight = chapterCameraWeight(tau, slot);
      if (weight > 0) {
        chapterWeight = weight;
        chapterAmplitude = slot.amplitude;
        break; // merged windows have disjoint ramps; no max-envelope switch
      }
    }
    if (chapterPath && chapterWeight > 0) {
      const lead = chapterLeadM * smoothLead((totalM - d) / (4 * chapterLeadM));
      const [cx, cy] = chapterPath(Math.min(totalM, d + lead));
      xs[j] += (cx - xs[j]) * chapterWeight;
      ys[j] += (cy - ys[j]) * chapterWeight;
    }
    const ordinaryZoom = baseZoom + BEAT_PUSH_ZOOM * push - lift;
    const zoom = ordinaryZoom + (baseZoom + chapterAmplitude - ordinaryZoom) * chapterWeight;
    zs[j] = route.source?.kind === 'waypoints' ? Math.min(WAYPOINT_MAX_ZOOM, zoom) : zoom;
  }
  const sz = smooth(zs, hz, ZOOM_SIGMA_SEC, 0);
  const shift = inp.shiftPx ?? { x: 0, y: 0 };

  return {
    chapterWindows,
    at(tau: number): Mcam {
      const p = Math.max(0, Math.min(K - 1, tau / dt));
      const j = Math.min(K - 2, Math.floor(p));
      const f = p - j;
      const sampledZoom = sz[j] + (sz[j + 1] - sz[j]) * f;
      const zoom = route.source?.kind === 'waypoints' ? Math.min(WAYPOINT_MAX_ZOOM, sampledZoom) : sampledZoom;
      // цель стоит в центре свободной области: центр камеры смещён на обратную величину в мировых единицах
      const world = TILE_SIZE * 2 ** zoom;
      return {
        x: xs[j] + (xs[j + 1] - xs[j]) * f - shift.x / world,
        y: ys[j] + (ys[j + 1] - ys[j]) * f - shift.y / world,
        zoom,
        pitch: 1,
      };
    },
  };
}

/** Мягкий ease-in-out (smootherstep): нулевые скорость и ускорение на концах — без толчка в начале и в конце. */
export const easeInOut = (s: number): number => {
  const x = Math.max(0, Math.min(1, s));
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/**
 * Перелёт между двумя камерами за e ∈ [0..1] (e уже сглажено). Зум — линейно по e, центр — так,
 * чтобы точка, к которой летим, плавно и равномерно на экране шла к центру кадра (без «заноса»).
 */
export function transition(from: Mcam, to: Mcam, e: number): Mcam {
  const zoom = from.zoom + (to.zoom - from.zoom) * e;
  const pitch = from.pitch + (to.pitch - from.pitch) * e;
  const delta = (((to.bearing ?? 0) - (from.bearing ?? 0) + 540) % 360) - 180;
  const bearing = (from.bearing ?? 0) + delta * e;
  if (to.zoom >= from.zoom) {
    // нырок: экранное смещение цели убывает как (1 − e)
    const f = (1 - e) * 2 ** (from.zoom - zoom);
    return { x: to.x + (from.x - to.x) * f, y: to.y + (from.y - to.y) * f, zoom, pitch, bearing };
  }
  // отъезд: зеркально — экранное смещение новой цели растёт как e
  const g = e * 2 ** (to.zoom - zoom);
  return { x: from.x + (to.x - from.x) * g, y: from.y + (to.y - from.y) * g, zoom, pitch, bearing };
}

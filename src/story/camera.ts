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

export interface Mcam { x: number; y: number; zoom: number; pitch: number; bearing?: number }

export const toCamera = (c: Mcam): CameraState => ({ center: [lonOf(c.x), latOf(c.y)], zoom: c.zoom, pitch: c.pitch, bearing: c.bearing ?? 0 });

export function overviewCamera(route: Route, viewport: ViewSize, padding?: Padding): Mcam {
  const pad = padding ?? Math.round(OVERVIEW_PADDING_SHARE * Math.min(viewport.width, viewport.height));
  const { center, zoom } = fitBounds(route.bbox, viewport, pad);
  return { x: mercX(center[0]), y: mercY(center[1]), zoom: Math.min(OVERVIEW_MAX_ZOOM, zoom), pitch: 0 };
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
export function journeyCamera(inp: JourneyCameraInput): { at(tau: number): Mcam } {
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
    zs[j] = baseZoom + BEAT_PUSH_ZOOM * push - lift;
  }
  const sz = smooth(zs, hz, ZOOM_SIGMA_SEC, 0);
  const shift = inp.shiftPx ?? { x: 0, y: 0 };

  return {
    at(tau: number): Mcam {
      const p = Math.max(0, Math.min(K - 1, tau / dt));
      const j = Math.min(K - 2, Math.floor(p));
      const f = p - j;
      const zoom = sz[j] + (sz[j + 1] - sz[j]) * f;
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

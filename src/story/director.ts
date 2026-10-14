import type { Route, ShotKind, ShotState } from '../types';
import { easeInOut, transition, type Mcam } from './camera';
import { mercX, mercY } from './mercator';

const KINDS: ShotKind[] = ['prologue', 'relief', 'line', 'point', 'context', 'finale'];
const EDGES = [0, 2.1, 4.3, 7.1, 9.7, 12.4, 15];
/** V5: шесть долей длительности; художественный ритм не утверждает события поездки. */
export function shotAt(t: number, duration: number): ShotState {
  const s = Math.max(0, Math.min(15, t * 15 / duration));
  const i = Math.max(0, KINDS.findIndex((_, k) => s < EDGES[k + 1] || k === 5));
  // Широкие плавные импульсы без скачка экспозиции на монтажных границах.
  const pulse = (a: number, b: number) => s > a && s < b ? Math.sin(Math.PI * (s - a) / (b - a)) ** 2 : 0;
  return { kind: KINDS[i], number: i + 1, fromSec: EDGES[i] * duration / 15,
    toSec: EDGES[i + 1] * duration / 15, light: 0.25 + 0.7 * pulse(2.1, 4.3) + 0.35 * pulse(9.7, 12.4),
    focus: pulse(7.1, 9.7) };
}

/**
 * План детерминированный: масштаб окна уже зависит от bbox/длины/темпа (journeyZoom).
 * Рельеф: средний план; линия: сопровождение; точка: наезд; контекст: шире.
 * Изменение высоты > 150 м, изгиб локальной касательной и географические биты
 * усиливают крупность. Разрыв расширяет план и не задаёт направление движения.
 * Поворот — ограниченный боковой ракурс локальной касательной (не вращение на 360°).
 * Всё предвычисляется на сетке 60 Гц, затем симметрично сглаживается на 0.8 с;
 * перемотка не зависит от истории. Геометрия маршрута этим не изменяется.
 */
export function directedJourney(route: Route, duration: number, introSec: number, journeySec: number,
  headAt: (tau: number) => number, base: { at(tau: number): Mcam }, maxZoom = 16.5, maxPitch = 74): { at(tau: number): Mcam } {
  const hz = 60, count = Math.ceil(journeySec * hz) + 1;
  const bearings = new Float64Array(count), pushes = new Float64Array(count);
  const pts = route.points, last = pts.length - 1;
  const radius = Math.max(1, Math.round(last * 0.025));
  for (let j = 0; j < count; j++) {
    const h = Math.min(last, Math.max(0, Math.round(headAt(j / hz))));
    let lo = Math.max(0, h - radius), hi = Math.min(last, h + radius);
    for (const leg of route.transfers) {
      if (leg.toIdx <= h) lo = Math.max(lo, leg.toIdx);
      if (leg.fromIdx >= h) hi = Math.min(hi, leg.fromIdx);
    }
    const a = pts[lo], b = pts[hi], p = pts[h];
    const gap = route.transfers.some(l => h >= l.fromIdx && h <= l.toIdx);
    const dx = mercX(b.lon) - mercX(a.lon), dy = mercY(b.lat) - mercY(a.lat);
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
    const prev = j ? bearings[j - 1] : angle;
    bearings[j] = gap || len < 1e-10 ? prev : prev + ((angle - prev + 540) % 360) - 180;
    const ax = mercX(p.lon) - mercX(a.lon), ay = mercY(p.lat) - mercY(a.lat);
    const bx = mercX(b.lon) - mercX(p.lon), by = mercY(b.lat) - mercY(p.lat);
    const turn = Math.abs(ax * by - ay * bx) / Math.max(1e-15, Math.hypot(ax, ay) * Math.hypot(bx, by));
    const climb = a.ele !== undefined && b.ele !== undefined ? Math.min(1, Math.abs(b.ele - a.ele) / 150) : 0;
    pushes[j] = gap ? -0.3 : 0.15 * Math.max(turn, climb);
  }
  const smooth = (data: Float64Array) => {
    const out = new Float64Array(count), half = 144;
    for (let j = 0; j < count; j++) {
      let sum = 0, weight = 0;
      for (let k = Math.max(0, j - half); k <= Math.min(count - 1, j + half); k++) {
        const w = Math.exp(-0.5 * ((k - j) / 48) ** 2); sum += data[k] * w; weight += w;
      }
      out[j] = sum / weight;
    }
    return out;
  };
  const bs = smooth(bearings), zs = smooth(pushes);
  return { at(tau) {
    const c = base.at(tau), q = Math.max(0, Math.min(count - 1, tau * hz));
    const i = Math.min(count - 2, Math.floor(q)), f = q - i;
    const shot = shotAt(tau + introSec, duration);
    const time = tau + introSec, s = time * 15 / duration;
    const z = c.zoom + zs[i] * (1 - f) + zs[i + 1] * f;
    const reliefU = Math.max(0, Math.min(1, (s - 2.1) / 2.2));
    const profiles = [
      { z: Math.min(z - 0.7, 12), p: 45, b: -20 },
      { z: Math.min(z - 0.7, 12), p: 64 + 10 * Math.sin(Math.PI * reliefU) ** 2, b: -25 },
      { z: Math.min(z, 13.2), p: 60, b: 10 },
      { z: Math.min(z + 0.4, 13.9), p: 53, b: 20 },
      { z: Math.min(z - 0.7, 12.3), p: 54, b: -10 },
      { z: Math.min(z - 0.7, 12.3), p: 40, b: -20 },
    ];
    const k = Math.min(5, shot.number - 1 + (time >= shot.toSec - 0.4 ? 1 : 0));
    const edge = EDGES[k] * duration / 15;
    const blend = k ? easeInOut((time - edge + 0.4) / 0.8) : 1;
    const a = profiles[Math.max(0, k - 1)], b = profiles[k];
    const zoom = Math.min(maxZoom, a.z + (b.z - a.z) * blend);
    return { ...c, zoom,
      pitch: Math.min(maxPitch, a.p + (b.p - a.p) * blend) / maxPitch,
      bearing: bs[i] * (1 - f) + bs[i + 1] * f + a.b + (b.b - a.b) * blend };
  } };
}

/** Пространственные области, сортировка запад→восток/юг→север; это камера, не хронология меток. */
export function regionOverview(route: Route, overview: Mcam, t: number, from: number, to: number): Mcam {
  const minX = mercX(route.bbox[0]), maxX = mercX(route.bbox[2]);
  const minY = mercY(route.bbox[3]), maxY = mercY(route.bbox[1]);
  const cells = new Map<number, { x: number; y: number; n: number }>();
  for (const p of route.points) {
    const x = mercX(p.lon), y = mercY(p.lat);
    const col = Math.min(2, Math.floor(3 * (x - minX) / Math.max(1e-12, maxX - minX)));
    const row = Math.min(1, Math.floor(2 * (y - minY) / Math.max(1e-12, maxY - minY)));
    const key = col * 2 + row, c = cells.get(key) ?? { x: 0, y: 0, n: 0 };
    c.x += x; c.y += y; c.n++; cells.set(key, c);
  }
  const targets = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, c]) =>
    ({ ...overview, x: c.x / c.n, y: c.y / c.n, zoom: overview.zoom + 1.3 }));
  const cameras = [overview, ...targets, overview];
  const q = Math.max(0, Math.min(cameras.length - 1, (t - from) / (to - from) * (cameras.length - 1)));
  const i = Math.min(cameras.length - 2, Math.floor(q));
  return transition(cameras[i], cameras[i + 1], easeInOut(q - i));
}

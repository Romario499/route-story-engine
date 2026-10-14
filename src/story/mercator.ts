// Web Mercator в долях мира [0..1] (та же плоскость, что у MapLibre) и подбор зума. Тайл — 512 px.
import type { ViewSize } from '../types';

export const TILE_SIZE = 512;
const RAD = Math.PI / 180;
const MAX_LAT = 85.051129;
/** Длина экватора, м — для перевода метров в доли мира. */
export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;
export const MAX_ZOOM = 20;

export const mercX = (lon: number): number => lon / 360 + 0.5;
export function mercY(lat: number): number {
  const s = Math.sin(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
export const lonOf = (x: number): number => (x - 0.5) * 360;
export const latOf = (y: number): number => (Math.atan(Math.sinh((0.5 - y) * 2 * Math.PI)) / RAD);

/** Сколько долей мира занимает метр на широте lat. */
export const mercPerMeter = (lat: number): number => 1 / (EARTH_CIRCUMFERENCE_M * Math.cos(lat * RAD));

/** Отступы кадра в CSS-пикселях MAP_VIEWPORT. */
export interface Padding { top: number; right: number; bottom: number; left: number }

/**
 * Центр и зум, при которых bbox [minLon, minLat, maxLon, maxLat] целиком помещается в viewport
 * (CSS-пиксели) за вычетом отступов и стоит по центру оставшегося окна. paddingPx — число (со всех сторон)
 * или {top, right, bottom, left}. Переход через 180° меридиан не поддерживается.
 */
export function fitBounds(
  bbox: [number, number, number, number], viewport: ViewSize, paddingPx: number | Padding,
): { center: [number, number]; zoom: number } {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const x0 = mercX(minLon), x1 = mercX(maxLon);
  const y0 = mercY(maxLat), y1 = mercY(minLat);
  let pad: Padding = typeof paddingPx === 'number'
    ? { top: paddingPx, right: paddingPx, bottom: paddingPx, left: paddingPx }
    : { ...paddingPx };
  for (const k of ['top', 'right', 'bottom', 'left'] as const) pad[k] = Math.max(0, Number.isFinite(pad[k]) ? pad[k] : 0);
  if (viewport.width - pad.left - pad.right < 1 || viewport.height - pad.top - pad.bottom < 1) {
    const q = Math.min(viewport.width, viewport.height) / 4;
    pad = { top: q, right: q, bottom: q, left: q };
  }
  const availW = viewport.width - pad.left - pad.right;
  const availH = viewport.height - pad.top - pad.bottom;
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const scales: number[] = [];
  if (dx > 0) scales.push(availW / (dx * TILE_SIZE));
  if (dy > 0) scales.push(availH / (dy * TILE_SIZE));
  const zoom = Math.max(0, Math.min(MAX_ZOOM, scales.length ? Math.log2(Math.min(...scales)) : MAX_ZOOM));
  // центр bbox должен встать в центр окна: окно смещено от центра кадра на ((l − r)/2, (t − b)/2)
  const world = TILE_SIZE * 2 ** zoom;
  const cx = (x0 + x1) / 2 - (pad.left - pad.right) / 2 / world;
  const cy = (y0 + y1) / 2 - (pad.top - pad.bottom) / 2 / world;
  return { center: [lonOf(cx), latOf(cy)], zoom };
}

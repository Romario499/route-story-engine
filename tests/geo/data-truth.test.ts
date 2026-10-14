// Достоверность данных (таск 11): склейка у границы, значимая высшая точка.
import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { buildRoute } from '../../src/route';
import type { RawTrack, Route, TrackPoint } from '../../src/types';

// Два квадрата 1°×1° вдоль экватора: AA 0…1, BB 1…2. ring = [x0, y0, dx, dy, …] в 1/1000°. Граница — меридиан 1°.
const countries: CountriesJson = {
  v: 1,
  scale: 1000,
  countries: [
    { iso2: 'AA', nameRu: 'Аа', nameEn: 'Aa', bbox: [0, 0, 1, 1], polygons: [[[0, 0, 1000, 0, 0, 1000, -1000, 0]]] },
    { iso2: 'BB', nameRu: 'Бб', nameEn: 'Bb', bbox: [1, 0, 2, 1], polygons: [[[1000, 0, 1000, 0, 0, 1000, -1000, 0]]] },
  ],
};
const places: PlacesJson = { v: 1, places: [] };
const geo = createGeoIndex(countries, places);

const KM = 1 / 111.195; // градусов на километр
const pt = (lon: number, lat = 0.5, ele?: number): TrackPoint => (ele === undefined ? { lat, lon } : { lat, lon, ele });
/** Точки от a до b по долготе с шагом ~1 км. */
function lonWalk(a: number, b: number, lat = 0.5): TrackPoint[] {
  const n = Math.max(1, Math.round(Math.abs(b - a) / KM));
  return Array.from({ length: n + 1 }, (_, i) => pt(a + ((b - a) * i) / n, lat));
}
function build(points: TrackPoint[]): Route {
  const track: RawTrack = { sourceFile: 't.gpx', segments: [points], waypoints: [] };
  const r = buildRoute([track]);
  if ('error' in r) throw new Error(r.error);
  return r;
}
const entries = (r: Route) =>
  enrichRoute(r, geo).beats.filter((b) => b.kind === 'country').map((b) => b.country?.iso2);

describe('склейка у границы (история 88)', () => {
  it('заезд на 30 км вглубь соседней страны и обратно — бит въезда и бит возвращения', () => {
    const r = build([...lonWalk(0.5, 1.0), ...lonWalk(1.0, 1.27).slice(1), ...lonWalk(1.27, 0.9).slice(1)]);
    expect(entries(r)).toEqual(['BB', 'AA']);
  });

  it('заезд на 7 км вглубь (путь 14 км < 15 км, но глубже 5 км от границы) — не прячется', () => {
    const r = build([...lonWalk(0.5, 1.0), ...lonWalk(1.0, 1.063).slice(1), ...lonWalk(1.063, 0.9).slice(1)]);
    expect(entries(r)).toEqual(['BB', 'AA']);
  });

  it('заход на 3 км за границу и обратно — дрожание у границы, битов нет', () => {
    const r = build([...lonWalk(0.5, 1.0), ...lonWalk(1.0, 1.027).slice(1), ...lonWalk(1.027, 0.9).slice(1)]);
    expect(entries(r)).toEqual([]);
    expect(enrichRoute(r, geo).countries.map((c) => c.iso2)).toEqual(['AA']);
  });

  it('зигзаг вдоль границы в 1 км от неё (путь ≈ 20 км, прямая ≈ 2 км) — склеивается', () => {
    const along = (lat0: number, lat1: number, lon: number): TrackPoint[] => {
      const n = Math.round(Math.abs(lat1 - lat0) / KM);
      return Array.from({ length: n + 1 }, (_, i) => pt(lon, lat0 + ((lat1 - lat0) * i) / n));
    };
    const r = build([...lonWalk(0.5, 0.99, 0.1), ...along(0.1, 0.19, 1.009).slice(0), ...along(0.19, 0.12, 1.009).slice(1), ...lonWalk(1.009, 0.99, 0.12).slice(1)]);
    expect(entries(r)).toEqual([]);
  });

  it('долгий проход вдоль границы (прямая > 15 км, даже в 1 км от неё) — это уже не дрожание', () => {
    const n = Math.round(0.2 / KM);
    const alongB = Array.from({ length: n + 1 }, (_, i) => pt(1.009, 0.1 + (0.2 * i) / n));
    const r = build([...lonWalk(0.5, 0.99, 0.1), ...alongB, ...lonWalk(1.009, 0.99, 0.3).slice(1)]);
    expect(entries(r)).toEqual(['BB', 'AA']);
  });
});

describe('значимая высшая точка (история 89)', () => {
  const walkEle = (ele: (i: number, n: number) => number): Route => {
    const base = lonWalk(0.1, 0.9);
    return build(base.map((p, i) => ({ ...p, ele: ele(i, base.length) })));
  };
  const hasPeak = (r: Route) => enrichRoute(r, geo).beats.some((b) => b.kind === 'peak');

  it('плоский городской трек с шумом высотомера — без peak', () => {
    expect(hasPeak(walkEle((i) => 120 + 12 * Math.sin(i)))).toBe(false);
  });

  it('перепад 250 м (< 300 м) — без peak, даже если пик выделяется', () => {
    expect(hasPeak(walkEle((i, n) => (i === n >> 1 ? 350 : 100)))).toBe(false);
  });

  it('перепад 300 м, но пик всего на 150 м выше медианы — без peak', () => {
    expect(hasPeak(walkEle((i, n) => 100 + (300 * i) / (n - 1)))).toBe(false);
  });

  it('настоящая гора (перепад ≥ 300 м, пик ≥ медиана + 200 м) — peak на высшей точке', () => {
    const r = walkEle((i, n) => 100 + 900 * Math.exp(-(((i - n / 2) / (n / 8)) ** 2)));
    const e = enrichRoute(r, geo);
    const peak = e.beats.find((b) => b.kind === 'peak');
    expect(peak?.idx).toBe(r.maxEle?.idx);
    expect(peak?.ele).toBeGreaterThan(900);
  });
});

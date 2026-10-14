// Фикстуры для тестов истории: маршрут — через публичный buildRoute, обогащение — руками по типу Enrichment.
import { buildRoute } from '../../src/route';
import type { Beat, Country, Enrichment, Place, RawTrack, Route, StorySettings, TrackPoint } from '../../src/types';

export const T0 = Date.UTC(2024, 4, 1, 6, 0, 0);

export function ok(r: Route | { error: string }): Route {
  if ('error' in r) throw new Error(`ожидался маршрут, получено: ${r.error}`);
  return r;
}

export const track = (sourceFile: string, segments: TrackPoint[][], extra: Partial<RawTrack> = {}): RawTrack => ({
  sourceFile, segments, waypoints: [], ...extra,
});

/** Детерминированный ГПСЧ (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = a;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Прямая на восток: n точек с шагом stepDeg по долготе; опционально время, высота, шум (метры). */
export function eastLine(n: number, opts: {
  lat?: number; lon0?: number; stepDeg?: number; t0?: number; dtSec?: number;
  ele?: (i: number) => number; noiseM?: number; seed?: number;
} = {}): TrackPoint[] {
  const { lat = 41, lon0 = 40, stepDeg = 0.001, t0, dtSec = 10, ele, noiseM = 0, seed = 1 } = opts;
  const rnd = rng(seed);
  const mPerDegLat = 111_195;
  const mPerDegLon = mPerDegLat * Math.cos((lat * Math.PI) / 180);
  return Array.from({ length: n }, (_, i) => {
    const p: TrackPoint = {
      lat: lat + (noiseM ? ((rnd() * 2 - 1) * noiseM) / mPerDegLat : 0),
      lon: lon0 + i * stepDeg + (noiseM ? ((rnd() * 2 - 1) * noiseM) / mPerDegLon : 0),
    };
    if (t0 !== undefined) p.time = t0 + i * dtSec * 1000;
    if (ele) p.ele = ele(i);
    return p;
  });
}

export const georgia: Country = { iso2: 'GE', nameRu: 'Грузия', nameEn: 'Georgia' };
export const armenia: Country = { iso2: 'AM', nameRu: 'Армения', nameEn: 'Armenia' };
export const tbilisi: Place = { nameRu: 'Тбилиси', nameEn: 'Tbilisi', lat: 41.7, lon: 44.8, pop: 1_100_000 };
export const yerevan: Place = { nameRu: 'Ереван', nameEn: 'Yerevan', lat: 40.18, lon: 44.51, pop: 1_090_000 };

/**
 * Обогащение руками: страна меняется на индексе border (Грузия → Армения),
 * place — Тбилиси в первой половине, Ереван во второй; биты — старт, въезд, финиш и extra.
 */
export function enrichmentFor(route: Route, opts: { border?: number; extraBeats?: Beat[]; beats?: Beat[] } = {}): Enrichment {
  const last = route.points.length - 1;
  const border = opts.border ?? Math.floor(last / 2);
  const placeAt = (idx: number) => (idx < border ? tbilisi : yerevan);
  const countryAt = (idx: number) => (idx < border ? georgia : armenia);
  const beats: Beat[] = opts.beats ?? [
    { kind: 'start', idx: 0, place: tbilisi },
    { kind: 'country', idx: border, country: armenia },
    ...(opts.extraBeats ?? []),
    { kind: 'finish', idx: last, place: yerevan },
  ];
  beats.sort((a, b) => a.idx - b.idx);
  return {
    countryRuns: [
      { fromIdx: 0, toIdx: border - 1, country: georgia },
      { fromIdx: border, toIdx: last, country: armenia },
    ],
    countries: [georgia, armenia],
    beats,
    startPlace: tbilisi,
    finishPlace: yerevan,
    placeAt,
    countryAt,
  };
}

export function settings(patch: Partial<StorySettings> = {}): StorySettings {
  return {
    styleId: 'epic', format: '9:16', durationSec: 30, lang: 'ru',
    info: { distance: true, day: true, date: false, country: true, city: false, altitude: true, speed: true, profile: false, progress: false },
    title: 'Тест', author: '', showSafeZones: false,
    ...patch,
  };
}

export function lineRoute(n: number, opts: Parameters<typeof eastLine>[1] = {}): Route {
  return ok(buildRoute([track('a.gpx', [eastLine(n, opts)])]));
}

/** Метры между двумя [lon, lat]. */
export function distM(a: [number, number], b: [number, number]): number {
  const R = 6_371_008.8, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Метры вдоль маршрута в дробном индексе. */
export function dAt(route: Route, head: number): number {
  const i = Math.min(Math.floor(head), route.points.length - 1);
  const f = head - i;
  const a = route.points[i].d;
  const b = route.points[Math.min(i + 1, route.points.length - 1)].d;
  return a + (b - a) * f;
}

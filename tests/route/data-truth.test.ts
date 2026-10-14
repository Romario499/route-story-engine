// Достоверность данных (таск 11): стоянка, дни, 180° меридиан.
import { describe, expect, it } from 'vitest';
import { buildRoute, ROUTE_ERRORS } from '../../src/route';
import type { RawTrack, Route, TrackPoint } from '../../src/types';


function ok(r: Route | { error: string }): Route {
  if ('error' in r) throw new Error(`ожидался маршрут, получено: ${r.error}`);
  return r;
}
const track = (points: TrackPoint[]): RawTrack => ({ sourceFile: 't.gpx', segments: [points], waypoints: [] });

/** Детерминированный шум в диапазоне ±amp. */
function noise(seed: number, amp: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s / 0xffffffff - 0.5) * 2 * amp;
  };
}
const M_PER_DEG_LAT = 111_195;

describe('скорость и расстояние на стоянке', () => {
  // 4 шага пешком по 111 м раз в минуту, затем 30 минут стоянки: точка раз в 5 с, шум GPS ±4 м
  const t0 = Date.UTC(2024, 4, 21, 5, 0, 0);
  const walk: TrackPoint[] = Array.from({ length: 5 }, (_, i) => ({ lat: 40 + i * 0.001, lon: 45, time: t0 + i * 60_000 }));
  const rnd = noise(7, 4);
  const stand: TrackPoint[] = Array.from({ length: 360 }, (_, i) => ({
    lat: 40.004 + rnd() / M_PER_DEG_LAT,
    lon: 45 + rnd() / (M_PER_DEG_LAT * Math.cos((40 * Math.PI) / 180)),
    time: t0 + 4 * 60_000 + (i + 1) * 5000,
  }));
  const r = ok(buildRoute([track([...walk, ...stand])]));

  it('30 минут дрожания ±4 м не добавляют километров: прирост totalM < 50 м', () => {
    const walkOnly = ok(buildRoute([track(walk)]));
    expect(r.totalM - walkOnly.totalM).toBeLessThan(50);
    expect(r.ownM - walkOnly.ownM).toBeLessThan(50);
  });

  it('на стоянке скорость не показывается (NaN), на ходу — показывается', () => {
    const speed = r.speedKmh as Float32Array;
    // середина стоянки: окно ±5 мин целиком внутри неё
    for (let i = walk.length + 130; i < walk.length + 230; i++) expect(Number.isNaN(speed[i])).toBe(true);
    // быстрый шаг (111 м/мин ≈ 6,7 км/ч) в начале — число
    expect(speed[1]).toBeGreaterThan(3);
  });
});

describe('скорость на стоянке с шумом GPS', () => {
  const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((40 * Math.PI) / 180);
  const t0 = Date.UTC(2024, 4, 21, 5, 0, 0);
  const stand = (amp: number, everySec: number, seconds: number): TrackPoint[] => {
    const rnd = noise(11 + amp, amp);
    return Array.from({ length: Math.round(seconds / everySec) }, (_, i) => ({
      lat: 40 + rnd() / M_PER_DEG_LAT, lon: 45 + rnd() / M_PER_DEG_LON, time: t0 + i * everySec * 1000,
    }));
  };

  // шум больше порога дрожания километров (15 м) раскручивает путь, но не смещение: скорость считается по смещению за окно
  it.each([
    [4, 5], [10, 5], [10, 1], [15, 5], [15, 1],
  ])('час стоянки с шумом ±%i м каждые %i с — скорость NaN', (amp, everySec) => {
    const pts = stand(amp, everySec, 3600);
    const speed = ok(buildRoute([track(pts)])).speedKmh as Float32Array;
    const from = Math.round(600 / everySec), to = pts.length - from; // середина: окно ±5 мин целиком внутри стоянки
    for (let i = from; i < to; i++) expect(Number.isNaN(speed[i]), `точка ${i}: ${speed[i]}`).toBe(true);
  });

  it('короткая стоянка (30 с) с шумом ±10 м каждую секунду — NaN во всех точках', () => {
    const speed = ok(buildRoute([track(stand(10, 1, 30))])).speedKmh as Float32Array;
    expect(speed.length).toBe(30);
    for (let i = 0; i < speed.length; i++) expect(Number.isNaN(speed[i]), `точка ${i}: ${speed[i]}`).toBe(true);
  });
});

describe('политика дней: календарные дни по солнечному времени точки', () => {
  const lon = 37.6; // солнечный пояс UTC+3 (долгота / 15, округлено)
  const at = (utcH: number, dayOfMonth = 21): number => Date.UTC(2024, 4, dayOfMonth, utcH);
  const pts = (times: number[]): TrackPoint[] => times.map((time, i) => ({ lat: 55 + i * 0.001, lon, time }));

  it('21 мая с 08:00 до 20:00 местного — один день', () => {
    const times = Array.from({ length: 13 }, (_, i) => at(5 + i)); // 08:00…20:00 местного = 05:00…17:00 UTC
    const r = ok(buildRoute([track(pts(times))]));
    expect(r.days).toBe(1);
    expect(Array.from(r.day as Uint16Array).every((d) => d === 1)).toBe(true);
  });

  it('поездка через местную полночь — два календарных дня, хотя длится всего 4 часа', () => {
    const times = [at(19), at(20), at(21), at(22), at(23)]; // 22:00 … 02:00 местного, полночь на третьей точке
    const r = ok(buildRoute([track(pts(times))]));
    expect(r.days).toBe(2);
    expect(Array.from(r.day as Uint16Array)).toEqual([1, 1, 2, 2, 2]);
  });

  it('длительность 25 часов внутри одной даты — не два дня, а ровно 24 часа подряд — два', () => {
    const sameDate = ok(buildRoute([track(pts([at(3), at(8), at(14), at(20)]))])); // 06:00…23:00 местного
    expect(sameDate.days).toBe(1);
    const nextDate = ok(buildRoute([track(pts([at(5), at(17), at(5, 22)]))])); // 08:00 → 08:00 следующей даты
    expect(nextDate.days).toBe(2);
  });
});

describe('180° меридиан', () => {
  const crossing: TrackPoint[] = [
    { lat: 65, lon: 179.9 }, { lat: 65, lon: 179.95 }, { lat: 65, lon: -179.95 }, { lat: 65, lon: -179.9 },
  ];

  it('маршрут через ±180° отклоняется до экспорта с готовым текстом', () => {
    const r = buildRoute([track(crossing)]);
    expect(r).toEqual({ error: ROUTE_ERRORS.antimeridian });
    expect(ROUTE_ERRORS.antimeridian).toBe('Маршрут пересекает 180° меридиан — такие маршруты пока не поддерживаются');
  });

  it('маршрут у самого меридиана, но не через него — строится', () => {
    const r = ok(buildRoute([track([{ lat: 65, lon: 179.5 }, { lat: 65, lon: 179.7 }, { lat: 65, lon: 179.95 }])]));
    expect(r.points).toHaveLength(3);
  });

  it('пересечение внутри второго файла тоже находится', () => {
    const a: RawTrack = { sourceFile: 'a.gpx', segments: [[{ lat: 10, lon: 10 }, { lat: 10, lon: 10.1 }]], waypoints: [] };
    expect(buildRoute([a, track(crossing)])).toEqual({ error: ROUTE_ERRORS.antimeridian });
  });
});

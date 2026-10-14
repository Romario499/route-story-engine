import { describe, expect, it } from 'vitest';
import { buildRoute, parseRouteText, ROUTE_ERRORS } from '../../src/route';
import type { RawTrack, Route, TrackPoint } from '../../src/types';

import trackGpx from '../fixtures/track.gpx?raw';
import routeGpx from '../fixtures/route.gpx?raw';

// 0,001° широты по меридиану ≈ 111,19 м (R ≈ 6371 км) — ожидаемые длины считаем от этой величины
const STEP_M = 111.19;
const T0 = Date.UTC(2024, 4, 1, 6, 0, 0);

function ok(r: Route | { error: string }): Route {
  if ('error' in r) throw new Error(`ожидался маршрут, получено: ${r.error}`);
  return r;
}

/** Прямая на север вдоль меридиана: n точек с шагом 0,001°, опционально время с шагом dtSec. */
function line(n: number, opts: { lat0?: number; lon?: number; t0?: number; dtSec?: number; ele?: (i: number) => number } = {}): TrackPoint[] {
  const { lat0 = 40, lon = 45, t0, dtSec = 60, ele } = opts;
  return Array.from({ length: n }, (_, i) => {
    const p: TrackPoint = { lat: lat0 + i * 0.001, lon };
    if (t0 !== undefined) p.time = t0 + i * dtSec * 1000;
    if (ele) p.ele = ele(i);
    return p;
  });
}

const track = (sourceFile: string, segments: TrackPoint[][], extra: Partial<RawTrack> = {}): RawTrack => ({
  sourceFile, segments, waypoints: [], ...extra,
});

const rel = (actual: number, expected: number, tol = 0.005) =>
  expect(Math.abs(actual - expected) / expected).toBeLessThan(tol);

describe('buildRoute — склейка файлов', () => {
  it('файлы со временем склеиваются по времени, каждый файл — свой сегмент, граница файлов — переезд', () => {
    const day2 = track('day2.gpx', [line(5, { lat0: 40.1, t0: T0 + 86_400_000 })]);
    const day1 = track('day1.gpx', [line(4, { lat0: 40.0, t0: T0 })]);
    const r = ok(buildRoute([day2, day1]));
    expect(r.points).toHaveLength(9);
    expect(r.points[0].time).toBe(T0);
    expect(r.points.slice(0, 4).every((p) => p.seg === 0)).toBe(true);
    expect(r.points.slice(4).every((p) => p.seg === 1)).toBe(true);
    expect(r.transfers).toEqual([{ fromIdx: 3, toIdx: 4 }]);
    expect(r.points[4].transferBefore).toBe(true);
    expect(r.points.filter((p) => p.transferBefore)).toHaveLength(1);
    // своим ходом: 3 + 4 шага; переезд 40.003 → 40.1 = 97 шагов идёт только в общий км
    rel(r.ownM, 7 * STEP_M);
    rel(r.totalM, (7 + 97) * STEP_M);
  });

  it('файлы без времени склеиваются в порядке выбора', () => {
    const a = track('a.csv', [line(3, { lat0: 41 })]);
    const b = track('b.csv', [line(3, { lat0: 40 })]);
    const r = ok(buildRoute([a, b]));
    expect(r.points[0].lat).toBe(41);
    expect(r.points[3].lat).toBe(40);
    expect(r.hasTime).toBe(false);
  });

  it('несколько trkseg одного файла — один сегмент без переезда, если разрыв < 30 км', () => {
    const parsed = parseRouteText('track.gpx', trackGpx);
    if (!parsed.ok) throw new Error(parsed.error);
    const r = ok(buildRoute(parsed.tracks));
    expect(r.points).toHaveLength(12);
    expect(r.transfers).toEqual([]);
    expect(r.name).toBe('День 1: Трабзон — Ризе');
  });
});

describe('buildRoute — очистка', () => {
  it('одиночный выброс > 400 км/ч с возвратом удаляется', () => {
    const pts = line(10, { t0: T0, dtSec: 60 });
    pts[5] = { ...pts[5], lat: pts[5].lat + 0.1 }; // +11 км за минуту ≈ 667 км/ч и назад
    const r = ok(buildRoute([track('spike.gpx', [pts])]));
    expect(r.points).toHaveLength(9);
    expect(r.points.some((p) => p.lat > 40.05)).toBe(false);
    expect(r.transfers).toEqual([]);
    rel(r.totalM, 9 * STEP_M);
  });

  it('быстрый, но не возвращающийся участок (поезд) не считается выбросом', () => {
    const slow = line(5, { t0: T0, dtSec: 60 });
    const fast = line(5, { lat0: 40.1, t0: T0 + 5 * 60_000, dtSec: 60 }).map((p, i) => ({ ...p, lat: 40.1 + i * 0.05 }));
    const r = ok(buildRoute([track('train.gpx', [[...slow, ...fast]])]));
    expect(r.points).toHaveLength(10);
  });

  it('дубликаты и точки с неверными координатами удаляются', () => {
    const pts = line(5, { t0: T0 });
    const dirty: TrackPoint[] = [
      pts[0], { ...pts[0] }, pts[1],
      { lat: NaN, lon: 45 }, { lat: 95, lon: 45 }, { lat: 40, lon: 200 }, { lat: 0, lon: 0 },
      pts[2], pts[3], { ...pts[3] }, pts[4],
    ];
    const r = ok(buildRoute([track('dirty.gpx', [dirty])]));
    expect(r.points.map((p) => p.lat)).toEqual(pts.map((p) => p.lat));
  });

  it('после очистки меньше 2 точек — ошибка tooFew; пустой ввод — empty', () => {
    expect(buildRoute([track('one.gpx', [[{ lat: 40, lon: 45 }, { lat: 40, lon: 45 }]])])).toEqual({ error: ROUTE_ERRORS.tooFew });
    expect(buildRoute([track('bad.gpx', [[{ lat: 99, lon: 45 }]])])).toEqual({ error: ROUTE_ERRORS.empty });
    expect(buildRoute([])).toEqual({ error: ROUTE_ERRORS.empty });
  });
});

describe('buildRoute — переезды', () => {
  it('скачок > 30 км внутри файла — переезд: не входит в ownM, входит в totalM', () => {
    const a = line(4, { lat0: 40 });
    const b = line(4, { lat0: 40.5 }); // 40.003 → 40.5: 497 шагов ≈ 55 км
    const r = ok(buildRoute([track('ferry.gpx', [[...a, ...b]])]));
    expect(r.transfers).toEqual([{ fromIdx: 3, toIdx: 4 }]);
    expect(r.points[4].transferBefore).toBe(true);
    expect(r.points[4].seg).toBe(1);
    rel(r.ownM, 6 * STEP_M);
    rel(r.totalM, (6 + 497) * STEP_M);
    // d — накопленные метры с переездами
    rel(r.points[7].d, r.totalM, 1e-9);
    expect(r.points[0].d).toBe(0);
  });

  it('разреженный rte (точки через 50–120 км) — без переездов, ownM = totalM', () => {
    const parsed = parseRouteText('route.gpx', routeGpx);
    if (!parsed.ok) throw new Error(parsed.error);
    const r = ok(buildRoute(parsed.tracks));
    expect(r.transfers).toEqual([]);
    expect(r.points.some((p) => p.transferBefore)).toBe(false);
    rel(r.ownM, r.totalM, 1e-9);
  });

  it('логгер раз в час (~60 км между точками) — без переездов, ownM = totalM', () => {
    // 0,54° широты ≈ 60 км за час, шаг слегка «гуляет», как у настоящей поездки
    const pts: TrackPoint[] = Array.from({ length: 12 }, (_, i) => ({
      lat: 38 + i * 0.54 + (i % 3) * 0.05,
      lon: 60 + (i % 2) * 0.1,
      time: T0 + i * 3_600_000,
    }));
    const r = ok(buildRoute([track('hourly.csv', [pts])]));
    expect(r.transfers).toEqual([]);
    rel(r.ownM, r.totalM, 1e-9);
    rel(r.totalM, 11 * 60_000, 0.15);
  });

  it('скачок < 30 км — не переезд', () => {
    const a = line(4, { lat0: 40 });
    const b = line(4, { lat0: 40.2 }); // ≈ 22 км
    const r = ok(buildRoute([track('gap.gpx', [[...a, ...b]])]));
    expect(r.transfers).toEqual([]);
    rel(r.ownM, r.totalM, 1e-9);
  });
});

describe('buildRoute — время, дни, скорость', () => {
  it('startTime/endTime/days и день по точкам (3 календарных дня)', () => {
    const d1 = line(3, { lat0: 40, lon: 0, t0: Date.UTC(2024, 4, 1, 8), dtSec: 3600 });
    const d2 = line(3, { lat0: 40.01, lon: 0, t0: Date.UTC(2024, 4, 2, 8), dtSec: 3600 });
    const d3 = line(3, { lat0: 40.02, lon: 0, t0: Date.UTC(2024, 4, 3, 8), dtSec: 3600 });
    const r = ok(buildRoute([track('d.gpx', [[...d1, ...d2, ...d3]])]));
    expect(r.hasTime).toBe(true);
    expect(r.startTime).toBe(Date.UTC(2024, 4, 1, 8));
    expect(r.endTime).toBe(Date.UTC(2024, 4, 3, 10));
    expect(r.days).toBe(3);
    expect(Array.from(r.day!)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  });

  it('скорость — среднее за ~10 мин; на стоянке NaN; переезд не завышает скорость соседних точек', () => {
    // 0,001° за 10 с ≈ 40 км/ч; потом 30 мин стоим; потом паром +55 км за 10 с и снова едем
    const drive1 = line(120, { lat0: 40, t0: T0, dtSec: 10 });
    const lastT = T0 + 119 * 10_000;
    const stop = Array.from({ length: 180 }, (_, i) => ({ lat: drive1[119].lat, lon: 45, time: lastT + (i + 1) * 10_000 }));
    const t2 = lastT + 181 * 10_000;
    const drive2 = line(120, { lat0: 40.7, t0: t2, dtSec: 10 });
    const r = ok(buildRoute([track('speed.gpx', [[...drive1, ...stop, ...drive2]])]));
    const s = r.speedKmh!;
    expect(s).toBeInstanceOf(Float32Array);
    expect(s.length).toBe(r.points.length);
    const kmh = (STEP_M / 10) * 3.6;
    rel(s[60], kmh, 0.02);
    const stopMid = r.points.findIndex((p) => p.time === lastT + 90 * 10_000);
    expect(Number.isNaN(s[stopMid])).toBe(true);
    const { fromIdx, toIdx } = r.transfers[0];
    expect(s[toIdx + 60]).toBeGreaterThan(kmh * 0.98);
    expect(s[toIdx + 60]).toBeLessThan(kmh * 1.02);
    for (const i of [fromIdx, toIdx]) {
      expect(Number.isNaN(s[i]) || s[i] < 100).toBe(true);
    }
  });

  it('без времени: hasTime=false, дни/скорость/даты отсутствуют', () => {
    const r = ok(buildRoute([track('plain.csv', [line(10)])]));
    expect(r.hasTime).toBe(false);
    expect(r.day).toBeUndefined();
    expect(r.speedKmh).toBeUndefined();
    expect(r.startTime).toBeUndefined();
    expect(r.endTime).toBeUndefined();
    expect(r.days).toBeUndefined();
  });
});

describe('buildRoute — высота, рамка, упрощение, остановки', () => {
  it('maxEle/minEle с индексами и набор высоты', () => {
    const eles = [100, 150, 140, 200, 120, 130];
    const r = ok(buildRoute([track('ele.gpx', [line(6, { ele: (i) => eles[i] })])]));
    expect(r.hasEle).toBe(true);
    expect(r.maxEle).toEqual({ value: 200, idx: 3 });
    expect(r.minEle).toEqual({ value: 100, idx: 0 });
    expect(r.gainM).toBeCloseTo(50 + 60 + 10, 6);
  });

  it('метровое дрожание высоты не накручивает набор', () => {
    const r = ok(buildRoute([track('jitter.gpx', [line(200, { ele: (i) => 500 + (i % 2) })])]));
    expect(r.gainM!).toBeLessThan(5);
  });

  it('без высоты: hasEle=false, поля высоты отсутствуют', () => {
    const r = ok(buildRoute([track('flat.csv', [line(10)])]));
    expect(r.hasEle).toBe(false);
    expect(r.maxEle).toBeUndefined();
    expect(r.minEle).toBeUndefined();
    expect(r.gainM).toBeUndefined();
  });

  it('bbox = [minLon, minLat, maxLon, maxLat]', () => {
    const pts: TrackPoint[] = [{ lat: 41, lon: 39.7 }, { lat: 41.6, lon: 41.6 }, { lat: 40.2, lon: 44.5 }, { lat: 43.2, lon: 76.9 }];
    const r = ok(buildRoute([track('bbox.gpx', [pts])]));
    expect(r.bbox).toEqual([39.7, 40.2, 76.9, 43.2]);
  });

  it('display: ≤ ~6000 индексов на длинном извилистом треке, первая, последняя и концы переездов включены', () => {
    const n = 50_000;
    const pts: TrackPoint[] = Array.from({ length: n }, (_, i) => ({
      lat: 40 + i * 0.0002 + 0.01 * Math.sin(i / 37),
      lon: 45 + 0.02 * Math.sin(i / 211) + 0.003 * Math.cos(i / 13),
    }));
    for (let i = 25_000; i < n; i++) pts[i] = { ...pts[i], lon: pts[i].lon + 1 }; // переезд ~85 км
    const r = ok(buildRoute([track('long.gpx', [pts])]));
    const d = r.display;
    expect(d.length).toBeLessThanOrEqual(6000);
    expect(d.length).toBeGreaterThan(500);
    expect(d[0]).toBe(0);
    expect(d[d.length - 1]).toBe(r.points.length - 1);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(r.transfers).toHaveLength(1);
    expect(d).toContain(r.transfers[0].fromIdx);
    expect(d).toContain(r.transfers[0].toIdx);
  });

  it('display короткого трека — все точки', () => {
    const r = ok(buildRoute([track('short.gpx', [line(100)])]));
    expect(r.display).toEqual(Array.from({ length: 100 }, (_, i) => i));
  });

  it('wpt привязываются к ближайшей точке трека; дальние (> 2% длины) отбрасываются', () => {
    const pts = line(101, { lat0: 40 }); // ≈ 11,1 км, 2% ≈ 222 м
    const r = ok(buildRoute([track('w.gpx', [pts], {
      waypoints: [
        { lat: 40.0302, lon: 45.001, name: 'Родник' },   // ≈ 85 м от точки 30
        { lat: 40.05, lon: 45.1, name: 'Далёкая гора' }, // ≈ 8,5 км в стороне
      ],
    })]));
    expect(r.waypoints).toEqual([{ lat: 40.0302, lon: 45.001, name: 'Родник', idx: 30 }]);
  });
});

import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { buildRoute } from '../../src/route';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';
import type { RawTrack, Route, TrackPoint, Waypoint } from '../../src/types';

// Три квадрата вдоль широты 0,5°: AA 0…1, BB 1…2, CC 3…4 (между BB и CC — «море»). ring = [x0, y0, dx, dy, …] в 1/1000°.
const countries: CountriesJson = {
  v: 1,
  scale: 1000,
  countries: [
    { iso2: 'AA', nameRu: 'Аа', nameEn: 'Aa', bbox: [0, 0, 1, 1], polygons: [[[0, 0, 1000, 0, 0, 1000, -1000, 0]]] },
    { iso2: 'BB', nameRu: 'Бб', nameEn: 'Bb', bbox: [1, 0, 2, 1], polygons: [[[1000, 0, 1000, 0, 0, 1000, -1000, 0]]] },
    { iso2: 'CC', nameRu: 'Вв', nameEn: 'Cc', bbox: [3, 0, 4, 1], polygons: [[[3000, 0, 1000, 0, 0, 1000, -1000, 0]]] },
  ],
};
const places: PlacesJson = {
  v: 1,
  places: [
    ['Город А', 'City A', 0.5, 0.0, 1000],
    ['Город Б', 'City B', 0.5, 1.9, 500],
    ['Город В', 'City C', 0.5, 3.9, 700],
  ],
};
const geo = createGeoIndex(countries, places);

const LAT = 0.5;
const pt = (lon: number, ele?: number): TrackPoint => (ele === undefined ? { lat: LAT, lon } : { lat: LAT, lon, ele });
const lons = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  const n = Math.round(Math.abs(to - from) / step);
  for (let i = 0; i <= n; i++) out.push(from + (to > from ? 1 : -1) * i * step);
  return out;
};
function route(points: TrackPoint[], waypoints: Waypoint[] = []): Route {
  const track: RawTrack = { sourceFile: 't.gpx', segments: [points], waypoints };
  const r = buildRoute([track]);
  if ('error' in r) throw new Error(r.error);
  return r;
}
const kinds = (r: ReturnType<typeof enrichRoute>) => r.beats.map((b) => b.kind);

describe('enrichRoute: страны', () => {
  it('куски стран, уникальные страны по порядку и countryAt/placeAt по индексу', () => {
    const r = route(lons(0.04, 1.94, 0.05).map((l) => pt(l)));
    const e = enrichRoute(r, geo);
    expect(e.countryRuns.map((x) => x.country?.iso2)).toEqual(['AA', 'BB']);
    expect(e.countries.map((c) => c.iso2)).toEqual(['AA', 'BB']);
    expect(e.countryRuns[0].fromIdx).toBe(0);
    expect(e.countryRuns[1].toIdx).toBe(r.points.length - 1);
    const firstB = e.countryRuns[1].fromIdx;
    expect(r.points[firstB].lon).toBeCloseTo(1.04, 6);
    expect(e.countryAt(firstB - 1)?.iso2).toBe('AA');
    expect(e.countryAt(firstB)?.iso2).toBe('BB');
    expect(e.countryAt(-1)).toBeNull();
    expect(e.countryAt(r.points.length)).toBeNull();
    expect(e.startPlace?.nameEn).toBe('City A');
    expect(e.finishPlace?.nameEn).toBe('City B');
    expect(e.placeAt(firstB - 1)).toBeNull(); // 0,95° — дальше 40 км и от А, и от Б
  });

  it('дрожание у границы не даёт лишних въездов', () => {
    // граница на 1,0°: между 0,9 и 1,1 — серия прыжков через неё на ~110 м
    const lonsList = [...lons(0.04, 0.89, 0.05), 0.9995, 1.0005, 0.9995, 1.0005, 0.9995, 1.0005, ...lons(1.14, 1.94, 0.05)];
    const r = route(lonsList.map((l) => pt(l)));
    const e = enrichRoute(r, geo);
    expect(e.countryRuns.map((x) => x.country?.iso2)).toEqual(['AA', 'BB']);
    expect(e.beats.filter((b) => b.kind === 'country')).toHaveLength(1);
    expect(e.beats.find((b) => b.kind === 'country')?.country?.iso2).toBe('BB');
  });

  it('туда и обратно: повторный въезд в страну — отдельный бит', () => {
    const lonsList = [...lons(0.04, 1.94, 0.05), ...lons(1.89, 0.04, 0.05)];
    const e = enrichRoute(route(lonsList.map((l) => pt(l))), geo);
    expect(e.countries.map((c) => c.iso2)).toEqual(['AA', 'BB']);
    expect(e.beats.filter((b) => b.kind === 'country').map((b) => b.country?.iso2)).toEqual(['BB', 'AA']);
  });

  it('переправа через «море»: пустой кусок, бит на въезде в следующую страну', () => {
    const lonsList = [...lons(0.04, 1.94, 0.05), ...lons(2.04, 2.94, 0.05), ...lons(3.04, 3.94, 0.05)];
    const r = route(lonsList.map((l) => pt(l)));
    const e = enrichRoute(r, geo);
    expect(e.countryRuns.map((x) => x.country?.iso2 ?? null)).toEqual(['AA', 'BB', null, 'CC']);
    expect(e.countries.map((c) => c.iso2)).toEqual(['AA', 'BB', 'CC']);
    const entry = e.beats.filter((b) => b.kind === 'country');
    expect(entry.map((b) => b.country?.iso2)).toEqual(['BB', 'CC']);
    expect(r.points[entry[1].idx].lon).toBeCloseTo(3.04, 6);
  });
});

describe('enrichRoute: биты', () => {
  it('start, въезд, peak, waypoint, finish — по возрастанию idx', () => {
    const l = lons(0.04, 1.94, 0.05);
    // высота растёт до 1,49° (там максимум 3000 м), дальше падает
    const pts = l.map((lon) => pt(lon, Math.round(3000 - Math.abs(lon - 1.49) * 1000)));
    const wpt: Waypoint = { lat: LAT + 0.0005, lon: 0.49, name: 'Привал' };
    const r = route(pts, [wpt]);
    const e = enrichRoute(r, geo);

    expect(kinds(e)).toEqual(['start', 'waypoint', 'country', 'peak', 'finish']);
    expect(e.beats.map((b) => b.idx)).toEqual([...e.beats.map((b) => b.idx)].sort((a, b) => a - b));

    const [start, wp, entry, peak, finish] = e.beats;
    expect(start.idx).toBe(0);
    expect(start.place?.nameEn).toBe('City A');
    expect(start.country?.iso2).toBe('AA');
    expect(wp.label).toBe('Привал');
    expect(r.points[wp.idx].lon).toBeCloseTo(0.49, 6);
    expect(entry.country?.iso2).toBe('BB');
    expect(peak.ele).toBe(3000);
    expect(r.points[peak.idx].lon).toBeCloseTo(1.49, 6);
    expect(finish.idx).toBe(r.points.length - 1);
    expect(finish.place?.nameEn).toBe('City B');
  });

  it('без высот peak не создаётся', () => {
    const r = route(lons(0.04, 1.94, 0.05).map((lon) => pt(lon)));
    expect(r.hasEle).toBe(false);
    expect(kinds(enrichRoute(r, geo))).not.toContain('peak');
  });

  it('остановка у самого старта или финиша не дублирует их карточки', () => {
    const l = lons(0.04, 1.94, 0.05);
    const r = route(l.map((lon) => pt(lon)), [
      { lat: LAT, lon: 0.0402, name: 'У старта' },
      { lat: LAT, lon: 1.9398, name: 'У финиша' },
      { lat: LAT, lon: 1.0, name: 'Середина' },
    ]);
    expect(r.waypoints).toHaveLength(3);
    const e = enrichRoute(r, geo);
    expect(e.beats.filter((b) => b.kind === 'waypoint').map((b) => b.label)).toEqual(['Середина']);
  });

  it('маршрут, начатый в «море», получает бит при первом выходе на сушу', () => {
    const r = route(lons(2.3, 2.9, 0.05).concat(lons(3.04, 3.94, 0.05)).map((lon) => pt(lon)));
    const e = enrichRoute(r, geo);
    expect(e.beats.filter((b) => b.kind === 'country').map((b) => b.country?.iso2)).toEqual(['CC']);
    expect(e.beats[0].kind).toBe('start');
    expect(e.beats[0].country).toBeUndefined();
  });
});

describe('enrichRoute: быстрота', () => {
  it('10 000 точек через всю Евразию на реальных границах — меньше секунды', () => {
    const realGeo = createGeoIndex(
      JSON.parse(countriesRaw) as CountriesJson,
      JSON.parse(placesRaw) as PlacesJson,
    );
    // от Трабзона до Хоргоса по прямой, ~5 км между точками — без разрывов
    const pts: TrackPoint[] = Array.from({ length: 10_000 }, (_, i) => {
      const f = i / 9_999;
      return { lat: 41.0 + 3.2 * f, lon: 39.7 + 40.7 * f, ele: 100 + (i % 50) };
    });
    const r = route(pts);
    const t0 = performance.now();
    const e = enrichRoute(r, realGeo);
    const ms = performance.now() - t0;
    expect(e.countries.length).toBeGreaterThanOrEqual(5);
    expect(e.beats.length).toBeGreaterThanOrEqual(7);
    expect(ms).toBeLessThan(1000);
  });
});

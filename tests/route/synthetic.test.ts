// Трудные синтетические треки (истории 102, 121): каждый файл помечен «синтетика», настоящего GPX у проекта нет.
import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { buildRoute, parseRouteText } from '../../src/route';
import type { Route } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';

const files = import.meta.glob('../fixtures/synthetic/*.gpx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const byName = (name: string): string => {
  const entry = Object.entries(files).find(([path]) => path.endsWith(`/${name}`));
  if (!entry) throw new Error(`нет фикстуры ${name}`);
  return entry[1];
};
const geo = createGeoIndex(JSON.parse(countriesRaw) as CountriesJson, JSON.parse(placesRaw) as PlacesJson);

function load(name: string): { route: Route } | { error: string } {
  const parsed = parseRouteText(name, byName(name));
  if (!parsed.ok) return { error: parsed.error };
  const built = buildRoute(parsed.tracks);
  return 'error' in built ? { error: built.error } : { route: built };
}
function route(name: string): Route {
  const r = load(name);
  if ('error' in r) throw new Error(`${name}: ${r.error}`);
  return r.route;
}

describe('синтетические фикстуры', () => {
  it('каждый файл помечен «синтетика» в имени файла и внутри (desc / комментарий)', () => {
    const names = Object.keys(files);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const [path, text] of Object.entries(files)) {
      expect(path.split('/').pop(), path).toMatch(/^synthetic-/);
      expect(text, path).toMatch(/<desc>Синтетика:/);
      expect(text, path).toMatch(/СИНТЕТИКА/);
    }
  });

  it('городской круг 10–20 км: со временем и плоской высотой, без переездов и без «высшей точки»', () => {
    const r = route('synthetic-city-14km.gpx');
    expect(r.totalM).toBeGreaterThan(10_000);
    expect(r.totalM).toBeLessThan(20_000);
    expect(r.hasTime && r.hasEle).toBe(true);
    expect(r.transfers).toEqual([]);
    expect((r.maxEle?.value as number) - (r.minEle?.value as number)).toBeLessThan(30);
    expect(enrichRoute(r, geo).beats.some((b) => b.kind === 'peak')).toBe(false);
  });

  it('без времени и без высоты: маршрут строится, зависимые показатели честно недоступны', () => {
    const noTime = route('synthetic-no-time.gpx');
    expect(noTime.hasTime).toBe(false);
    expect(noTime.speedKmh).toBeUndefined();
    expect(noTime.days).toBeUndefined();
    expect(noTime.totalM).toBeGreaterThan(10_000);
    const noEle = route('synthetic-no-ele.gpx');
    expect(noEle.hasEle).toBe(false);
    expect(noEle.maxEle).toBeUndefined();
    expect(noEle.days).toBe(1);
  });

  it('длинное название RU/EN (≥ 80 символов) доходит до маршрута целиком', () => {
    const r = route('synthetic-long-name.gpx');
    expect(r.name?.length).toBeGreaterThanOrEqual(80);
    expect(r.name).toMatch(/Золотому кольцу/);
    expect(r.name).toMatch(/Golden Ring/);
  });

  it('стоянка с шумом: километры не растут, скорость на стоянке не показывается', () => {
    const r = route('synthetic-stand-noise.gpx');
    expect(r.totalM).toBeLessThan(444 + 50); // 4 шага по 111 м + остаток
    const speed = r.speedKmh as Float32Array;
    expect(Number.isNaN(speed[5 + 180])).toBe(true);
  });

  it('пустой и битый файлы дают понятную ошибку, а не падение', () => {
    const empty = load('synthetic-empty.gpx');
    expect('error' in empty && empty.error).toBeTruthy();
    const broken = load('synthetic-broken.gpx');
    expect('error' in broken && broken.error).toMatch(/[А-Яа-я]/);
  });
});

describe('эвристика разрывов D01 на синтетике (история 121)', () => {
  it('прыжок на 50 км за 45 минут посреди велотрека (18 км/ч) — один разрыв, километры в totalM, но не в ownM', () => {
    const r = route('synthetic-gap-50km.gpx');
    expect(r.transfers).toHaveLength(1);
    const { fromIdx, toIdx } = r.transfers[0];
    expect(r.points[toIdx].d - r.points[fromIdx].d).toBeGreaterThan(49_000);
    expect(r.totalM - r.ownM).toBeGreaterThan(49_000);
    expect(r.ownM).toBeLessThan(45_000); // 2 × ~20 км своим ходом
  });

  it('плотный трек (городской круг) — без разрывов', () => {
    const r = route('synthetic-city-14km.gpx');
    expect(r.transfers).toEqual([]);
    expect(r.ownM).toBeCloseTo(r.totalM, 6);
  });

  it('редкий логгер (точка раз в час, ~60 км) — без разрывов', () => {
    const r = route('synthetic-sparse-logger.gpx');
    expect(r.points).toHaveLength(12);
    expect(r.transfers).toEqual([]);
    expect(r.ownM).toBeCloseTo(r.totalM, 6);
  });
});

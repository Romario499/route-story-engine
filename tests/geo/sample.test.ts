import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { buildRoute, parseRouteText } from '../../src/route';
import type { Route } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';
import sampleGpx from '../../public/samples/wahrier-reconstruction.gpx?raw';

const geo = createGeoIndex(JSON.parse(countriesRaw) as CountriesJson, JSON.parse(placesRaw) as PlacesJson);

function load(): Route {
  const parsed = parseRouteText('wahrier-reconstruction.gpx', sampleGpx);
  if (!parsed.ok) throw new Error(parsed.error);
  const route = buildRoute(parsed.tracks);
  if ('error' in route) throw new Error(route.error);
  return route;
}

describe('пример @wahrier (реконструкция)', () => {
  const route = load();
  const e = enrichRoute(route, geo);

  it('подписан как реконструкция, а не GPS-запись', () => {
    expect(sampleGpx).toMatch(/<name>[^<]*Реконструкция маршрута[^<]*не GPS-запись/);
    expect(sampleGpx).toMatch(/<desc>[^<]*реконструкция маршрута по афише, не GPS-запись/i);
    expect(route.name).toMatch(/Реконструкция/);
  });

  it('несколько тысяч точек с высотой и временем', () => {
    expect(route.points.length).toBeGreaterThanOrEqual(3000);
    expect(route.points.length).toBeLessThanOrEqual(8000);
    expect(route.hasTime).toBe(true);
    expect(route.hasEle).toBe(true);
    expect(route.days).toBeGreaterThan(40);
    expect(route.totalM).toBeGreaterThan(4_000_000);
    expect(route.maxEle?.value).toBeGreaterThan(2000); // Кыргызстан / Иран — выше 2 км
  });

  it('ровно один переезд — паром Решт → Актау, сотни километров по прямой', () => {
    expect(route.transfers).toHaveLength(1);
    const { fromIdx, toIdx } = route.transfers[0];
    const ferryM = route.points[toIdx].d - route.points[fromIdx].d;
    expect(ferryM).toBeGreaterThan(500_000);
    expect(ferryM).toBeLessThan(1_000_000);
    expect(e.countryAt(fromIdx)?.iso2).toBe('IR');
    expect(e.countryAt(toIdx)?.iso2).toBe('KZ');
  });

  it('скорость правдоподобна для велопутешественника: медиана 15–22 км/ч, максимум ≤ 40, зависит от рельефа', () => {
    const v = Array.from(route.speedKmh ?? []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    expect(v.length).toBeGreaterThan(route.points.length * 0.9); // почти везде есть скорость (стоянки — единицы точек)
    const median = v[v.length >> 1];
    expect(median).toBeGreaterThanOrEqual(15);
    expect(median).toBeLessThanOrEqual(22);
    expect(v[v.length - 1]).toBeLessThanOrEqual(40);
    expect(v[Math.floor(v.length * 0.05)]).toBeLessThan(15); // есть медленные подъёмы
    expect(v[Math.floor(v.length * 0.95)]).toBeGreaterThan(22); // и быстрые спуски
  });

  it('дни: выезд около 8:00 местного, 70–120 км в день, ночью трек не пишется', () => {
    const pts = route.points;
    const dayKm: number[] = [];
    let startIdx = 0;
    const solarHour = (i: number) => ((((pts[i].time as number) / 3_600_000 + Math.round(pts[i].lon / 15)) % 24) + 24) % 24;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].transferBefore) { startIdx = i; continue; }
      const dt = (pts[i].time as number) - (pts[i - 1].time as number);
      if (dt > 6 * 3_600_000) { // ночёвка: пауза, а точек внутри неё нет
        expect(pts[i].d - pts[i - 1].d).toBeLessThan(1); // на том же месте
        expect(solarHour(i)).toBeGreaterThanOrEqual(7.9);
        expect(solarHour(i)).toBeLessThanOrEqual(8.8);
        dayKm.push((pts[i - 1].d - pts[startIdx].d) / 1000);
        startIdx = i;
      }
    }
    expect(dayKm.length).toBeGreaterThan(50);
    const full = dayKm.filter((km) => km > 1); // «день» нулевой длины — ожидание в порту после парома
    expect(full.length).toBe(dayKm.length - 1);
    expect(Math.min(...full)).toBeGreaterThanOrEqual(69);
    expect(Math.max(...full)).toBeLessThanOrEqual(121);
    const mean = full.reduce((a, b) => a + b, 0) / full.length;
    expect(mean).toBeGreaterThan(85);
    expect(mean).toBeLessThan(105);
  });

  it('страны в порядке маршрута афиши', () => {
    const order = e.beats.filter((b) => b.kind === 'country').map((b) => b.country?.iso2);
    // Турция — страна старта (бит start), дальше въезды
    expect(e.beats[0].country?.iso2).toBe('TR');
    // Азербайджан — ложный въезд: маршрут местами идёт вдоль границы Армении в 2 км от неё (склейка у границы, история 88)
    expect(order).not.toContain('AZ');
    // С порогом 70 км реконструкция прятала четыре коротких захода (Ташкент ↔ Казахстан, Талас ↔ Кыргызстан):
    // теперь это честные биты — участки длиннее 15 км или глубже 5 км от границы не склеиваются.
    expect(order).toEqual(['GE', 'AM', 'IR', 'KZ', 'UZ', 'KZ', 'UZ', 'KZ', 'KG', 'KZ', 'KG', 'KZ', 'CN']);
    expect(e.countries.map((c) => c.iso2)).toEqual(['TR', 'GE', 'AM', 'IR', 'KZ', 'UZ', 'KG', 'CN']);
  });

  it('старт — Трабзон, финиш у Хоргоса, остановки — города с афиши', () => {
    expect(e.startPlace?.nameEn).toBe('Trabzon');
    // финиш — у китайского Хоргоса, а не у казахстанского Жаркента в 35 км
    expect(e.finishPlace?.nameRu).toBe('Хоргос');
    expect(e.finishPlace?.nameEn).toBe('Khorgos');
    const labels = e.beats.filter((b) => b.kind === 'waypoint').map((b) => b.label);
    for (const city of ['Тбилиси', 'Ереван', 'Тебриз', 'Нукус', 'Хива', 'Бухара', 'Самарканд', 'Ташкент', 'Бишкек', 'Каракол', 'Алматы']) {
      expect(labels).toContain(city);
    }
    expect(e.beats.some((b) => b.kind === 'peak')).toBe(true);
    expect(e.beats[e.beats.length - 1].kind).toBe('finish');
  });
});

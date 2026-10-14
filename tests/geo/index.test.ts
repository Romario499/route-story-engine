import { describe, expect, it } from 'vitest';
import { createGeoIndex } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';

const countries = JSON.parse(countriesRaw) as CountriesJson;
const places = JSON.parse(placesRaw) as PlacesJson;
const real = createGeoIndex(countries, places);

describe('countryAt на реальных public/data', () => {
  // координаты городов — общеизвестные (центры), порядок [lon, lat]
  const cities: [string, number, number, string][] = [
    ['Трабзон', 39.7168, 41.0027, 'TR'],
    ['Тбилиси', 44.8271, 41.7151, 'GE'],
    ['Ереван', 44.5086, 40.1792, 'AM'],
    ['Тебриз', 46.2919, 38.08, 'IR'],
    ['Актау', 51.1572, 43.6532, 'KZ'],
    ['Самарканд', 66.9597, 39.6542, 'UZ'],
    ['Бишкек', 74.5698, 42.8746, 'KG'],
    ['Алматы', 76.8897, 43.2389, 'KZ'],
  ];
  it.each(cities)('%s → %s', (_name, lon, lat, iso2) => {
    expect(real.countryAt(lon, lat)?.iso2).toBe(iso2);
  });

  it('по обе стороны границы у Хоргоса: Казахстан и Китай', () => {
    // граница Хоргоса проходит около 80,37° в.д.; точки в ~3 км от неё с каждой стороны
    expect(real.countryAt(80.33, 44.2)?.iso2).toBe('KZ');
    expect(real.countryAt(80.4, 44.2)?.iso2).toBe('CN');
  });

  it('отдаёт русское и английское название', () => {
    const c = real.countryAt(44.8271, 41.7151);
    expect(c).toEqual({ iso2: 'GE', nameRu: 'Грузия', nameEn: 'Georgia' });
  });

  it('середина Каспия и океан — вне стран', () => {
    expect(real.countryAt(51.0, 41.0)).toBeNull();
    expect(real.countryAt(-30, 0)).toBeNull();
  });
});

// Две квадратные страны и дырка: ring = [x0, y0, dx, dy, …] в 1/1000°
const fixtureCountries: CountriesJson = {
  v: 1,
  scale: 1000,
  countries: [
    {
      iso2: 'AA', nameRu: 'Аа', nameEn: 'Aa', bbox: [0, 0, 1, 1],
      polygons: [[[0, 0, 1000, 0, 0, 1000, -1000, 0], [200, 200, 200, 0, 0, 200, -200, 0]]], // контур + дырка 0,2…0,4
    },
    { iso2: 'BB', nameRu: 'Бб', nameEn: 'Bb', bbox: [1, 0, 2, 1], polygons: [[[1000, 0, 1000, 0, 0, 1000, -1000, 0]]] },
  ],
};
const fixturePlaces: PlacesJson = {
  v: 1,
  places: [
    ['Город А', 'City A', 0.5, 0.1, 1000],
    ['Город Б', 'City B', 0.5, 1.9, 500],
  ],
};
const small = createGeoIndex(fixtureCountries, fixturePlaces);

describe('createGeoIndex на малых фикстурах', () => {
  it('точка внутри дырки полигона — вне страны', () => {
    expect(small.countryAt(0.3, 0.3)).toBeNull();
    expect(small.countryAt(0.6, 0.6)?.iso2).toBe('AA');
    expect(small.countryAt(1.5, 0.5)?.iso2).toBe('BB');
  });

  it('точка в паре километров от контура (грубый берег) относится к стране, дальше — нет', () => {
    expect(small.countryAt(-0.02, 0.5)?.iso2).toBe('AA'); // 0,02° ≈ 2,2 км западнее границы
    expect(small.countryAt(-0.2, 0.5)).toBeNull();        // 22 км — уже «море»
  });

  it('nearestPlace: город в радиусе находится, вне радиуса — null', () => {
    // 0,4° долготы на широте 0,5° ≈ 0,4 × 111,19 км × cos(0,5°) ≈ 44,5 км
    expect(small.nearestPlace(0.5, 0.5, 40)).toBeNull();
    expect(small.nearestPlace(0.5, 0.5, 50)?.nameEn).toBe('City A');
    expect(small.nearestPlace(0.105, 0.5, 1)?.nameRu).toBe('Город А');
  });

  it('nearestPlace выбирает ближайший из двух', () => {
    expect(small.nearestPlace(1.6, 0.5, 100)?.nameEn).toBe('City B');
    expect(small.nearestPlace(0.4, 0.5, 100)?.nameEn).toBe('City A');
  });

  it('nearestPlace на реальных данных: у Самарканда — Самарканд, посреди Каспия — null', () => {
    expect(real.nearestPlace(66.9597, 39.6542, 40)).toMatchObject({ nameRu: 'Самарканд', nameEn: 'Samarkand' });
    expect(real.nearestPlace(51.0, 41.0, 40)).toBeNull();
  });
});

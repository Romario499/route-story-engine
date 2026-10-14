// Браузерная загрузка гео-данных из public/data (собственные статические файлы, без внешних API).
import { createGeoIndex } from './index';
import type { CountriesJson, GeoIndex, PlacesJson } from './index';

/** Путь по умолчанию относительный — работает при Vite `base: './'` (и на GitHub Pages в подпапке). */
export const DEFAULT_GEO_BASE = './';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось загрузить ${url}: ${res.status}`);
  return (await res.json()) as T;
}

export async function loadGeoData(baseUrl: string = DEFAULT_GEO_BASE): Promise<GeoIndex> {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const [countries, places] = await Promise.all([
    fetchJson<CountriesJson>(`${base}data/countries.json`),
    fetchJson<PlacesJson>(`${base}data/places.json`),
  ]);
  return createGeoIndex(countries, places);
}

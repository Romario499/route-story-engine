import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGeoData } from '../../src/geo/load';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';

function stubFetch(requested: string[]) {
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(String(url));
    const body = String(url).endsWith('countries.json') ? countriesRaw : placesRaw;
    return new Response(body, { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('loadGeoData', () => {
  it('по умолчанию берёт файлы по относительному пути (base: ./)', async () => {
    const requested: string[] = [];
    stubFetch(requested);
    const geo = await loadGeoData();
    expect([...requested].sort()).toEqual(['./data/countries.json', './data/places.json']);
    expect(geo.countryAt(44.8271, 41.7151)?.iso2).toBe('GE');
    expect(geo.nearestPlace(44.8271, 41.7151, 40)?.nameEn).toBe('Tbilisi');
  });

  it('учитывает baseUrl с косой чертой и без неё', async () => {
    const requested: string[] = [];
    stubFetch(requested);
    await loadGeoData('/app');
    await loadGeoData('/app/');
    expect(requested.filter((u) => u.startsWith('/app/data/'))).toHaveLength(4);
    expect(requested.some((u) => u.includes('//data'))).toBe(false);
  });

  it('при HTTP-ошибке бросает понятное исключение', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 404 }));
    await expect(loadGeoData()).rejects.toThrow(/countries\.json.*404/);
  });
});

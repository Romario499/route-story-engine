import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import trackGpx from '../fixtures/track.gpx?raw';
import routeGpx from '../fixtures/route.gpx?raw';
import * as routeModule from '../../src/route';
import * as geoModule from '../../src/geo';
import { attachEnrichment, ENRICH_FAILED_MESSAGE } from '../../src/ui/enrich';
import { IMPORT_FAILED_MESSAGE, importText } from '../../src/ui/step-route';
import { createStore } from '../../src/ui/state';

// Подменяем только buildRoute / enrichRoute — по умолчанию они настоящие, в тесте могут «упасть».
vi.mock('../../src/route', async (orig) => {
  const actual = await orig<typeof import('../../src/route')>();
  return { ...actual, buildRoute: vi.fn(actual.buildRoute) };
});
vi.mock('../../src/geo', async (orig) => {
  const actual = await orig<typeof import('../../src/geo')>();
  return { ...actual, enrichRoute: vi.fn(actual.enrichRoute) };
});
vi.mock('../../src/geo/load', () => ({
  loadGeoData: async () => ({ countryAt: () => null, nearestPlace: () => null }),
}));

const RUSSIAN = /[А-Яа-яЁё]{4,}/;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('сбой при загрузке маршрута', () => {
  it('исключение из buildRoute — русское сообщение, загрузка гаснет, прошлый маршрут остаётся', async () => {
    const store = createStore();
    await importText(store, 'track.gpx', trackGpx);
    const before = store.get();
    expect(before.status.phase).toBe('ready');
    expect(before.route).not.toBeNull();

    vi.mocked(routeModule.buildRoute).mockImplementationOnce(() => { throw new Error('boom'); });
    await importText(store, 'route.gpx', routeGpx);

    const after = store.get();
    expect(after.status).toEqual({ phase: 'error', message: IMPORT_FAILED_MESSAGE });
    expect(IMPORT_FAILED_MESSAGE).toMatch(RUSSIAN);
    expect(after.route).toBe(before.route);
    expect(after.source).toBe(before.source);
  });

  it('исключение из разбора файла тоже не оставляет вечную загрузку', async () => {
    const store = createStore();
    const seen: string[] = [];
    store.subscribe((s) => seen.push(s.status.phase));
    const bad = { toString: () => { throw new Error('boom'); } } as unknown as string;
    await importText(store, 'broken.gpx', bad);
    expect(seen).toContain('loading');
    expect(store.get().status.phase).toBe('error');
  });
});

describe('сбой при обогащении маршрута', () => {
  it('исключение из enrichRoute — русское сообщение и возврат к прошлому маршруту', async () => {
    const store = createStore();
    attachEnrichment(store);
    await importText(store, 'track.gpx', trackGpx);
    await flush();
    const good = store.get();
    expect(good.enrichment).not.toBeNull();

    vi.mocked(geoModule.enrichRoute).mockImplementationOnce(() => { throw new Error('boom'); });
    await importText(store, 'route.gpx', routeGpx);
    await flush();

    const after = store.get();
    expect(after.status).toEqual({ phase: 'error', message: ENRICH_FAILED_MESSAGE });
    expect(ENRICH_FAILED_MESSAGE).toMatch(RUSSIAN);
    expect(after.route).toBe(good.route);
    expect(after.enrichment).toBe(good.enrichment);
    expect(after.source).toBe(good.source);
  });

  it('если прошлого маршрута не было — состояние пустое, но с сообщением', async () => {
    const store = createStore();
    attachEnrichment(store);
    vi.mocked(geoModule.enrichRoute).mockImplementationOnce(() => { throw new Error('boom'); });
    await importText(store, 'track.gpx', trackGpx);
    await flush();
    const s = store.get();
    expect(s.route).toBeNull();
    expect(s.enrichment).toBeNull();
    expect(s.status.phase).toBe('error');
  });
});

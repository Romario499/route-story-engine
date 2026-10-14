import { afterEach, expect, it, vi } from 'vitest';
import { buildTimeline } from '../../src/story';
import { importDefaults } from '../../src/ui/step-route';
import { DEFAULT_SETTINGS } from '../../src/ui/state';
import { createStore } from '../../src/ui/state';
import { importFiles, loadWaypointSample } from '../../src/ui/step-route';
import { CHAPTER_FILE_ERROR } from '../../src/route/chapters';
import waypointSample from '../fixtures/synthetic/waypoint-sample.json?raw';
import { enrichmentFor, lineRoute, settings } from '../story/fixtures';
import { jw, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';
afterEach(() => { vi.unstubAllGlobals(); });

it('необязательные главы отсутствуют: тихо без глав; неверный выбранный файл сохраняет понятное предупреждение', async () => {
  for (const missing of ['404', 'html', 'network'] as const) {
    vi.stubGlobal('fetch', async (url: string) => {
      if (!String(url).endsWith('/chapters.json')) return new Response(waypointSample);
      if (missing === 'network') throw new TypeError('Failed to fetch');
      return missing === '404' ? new Response('', { status: 404 }) : new Response('<!doctype html><html></html>');
    });
    const store = createStore();
    await loadWaypointSample(store, { chapters: true });
    expect(store.get().status.phase).toBe('ready');
    expect(store.get().route?.source?.kind).toBe('waypoints');
    expect(store.get().route?.chapters).toBeUndefined();
    expect(store.get().source?.warnings, missing).toEqual([]);
    expect(store.get().source?.files).not.toContain('chapters.json');
    await importFiles(store, [new File(['{}'], 'chapters.json')]);
    expect(store.get().status.phase).toBe('ready');
    expect(store.get().source?.warnings).toContain(CHAPTER_FILE_ERROR);
    expect(store.get().route?.chapters).toBeUndefined();
  }
});
it('города включены только для меток; на перелёте, в том числе внутри страны, города нет', () => {
  const route = waypointRoute([jw(40,30,'overnight',0),jw(40,40,'overnight',1),jw(40,40.2,'overnight',2)]);
  expect(importDefaults(route, false, DEFAULT_SETTINGS.info).city).toBe(true);
  expect(importDefaults(lineRoute(20), false, DEFAULT_SETTINGS.info).city).toBe(false);
  const env = enrichmentFor(route, { border: 3 });
  const tl = buildTimeline(route, env, settings());
  const frames = Array.from({ length: 901 }, (_, i) => tl.frameAt(i / 30));
  const hop = frames.filter(f => f.head > 0.1 && f.head < 0.9);
  expect(hop.length).toBeGreaterThan(0);
  expect(hop.every(f => f.stats.place === null && !f.placeChange?.visible)).toBe(true);
  expect(frames.find(f => f.head === 0 && f.act === 'journey')?.stats.place?.nameEn).toBe('Tbilisi');
});

it('подключение только файла глав сохраняет происхождение уже загруженного маршрута', async () => {
  const store = createStore({ route: lineRoute(20), source: { files: ['fictional.gpx'], warnings: ['Пометка исходного маршрута'], reconstruction: true } });
  await importFiles(store, [new File(['[]'], 'chapters.json')]);
  expect(store.get().status.phase).toBe('ready');
  expect(store.get().source).toEqual({ files: ['fictional.gpx', 'chapters.json'], warnings: ['Пометка исходного маршрута'], reconstruction: true });
});

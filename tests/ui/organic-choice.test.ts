import { expect, it, vi } from 'vitest';
import * as importer from '../../src/ui/step-route';
import { createStore } from '../../src/ui/state';
import { organicMixed } from '../fixtures/synthetic/organic-mixed';
import { syntheticZip } from '../route/zip-fixture';
import { buildTimeline } from '../../src/story';
import { enrichRoute, createGeoIndex } from '../../src/geo';
import { createImportChoice, buildRoute, parseRouteText } from '../../src/route';

it('Organic Maps: 12 ночёвок → метки, переключение без чтения файла и без личной линии в кадре', async () => {
  const file = new File([new Uint8Array(syntheticZip([{ name: 'doc.kml', text: organicMixed() }]))], 'synthetic.kmz');
  const read = vi.spyOn(file, 'arrayBuffer');
  const store = createStore();
  await importer.importFiles(store, [file]);
  expect(store.get().route?.source?.kind).toBe('waypoints');
  const marks = store.get().route!;
  expect(marks.points).toHaveLength(12);
  expect(marks.points.every((p) => p.lon >= 30 && p.lat === 40 && p.d === 0 && p.ele === undefined)).toBe(true);
  expect(marks.totalM).toBe(0);
  const geo = createGeoIndex({ v: 1, scale: 1, countries: [] }, { v: 1, places: [] });
  const timeline = buildTimeline(marks, enrichRoute(marks, geo), store.get().settings);
  for (let t = 0; t <= 30; t += 0.5) {
    const frame = timeline.frameAt(t);
    expect(frame.headLonLat[0]).toBeGreaterThanOrEqual(30);
    expect(frame.headLonLat[1]).toBeCloseTo(40, 10);
  }
  await importer.selectImportKind(store, 'track');
  expect(store.get().route?.source?.kind).not.toBe('waypoints');
  expect(store.get().route?.points.map((p) => p.lon)).toEqual([10, 10.01]);
  expect(store.get().settings.info.distance).toBe(true);
  await importer.selectImportKind(store, 'waypoints');
  expect(store.get().route?.points).toEqual(marks.points);
  expect(store.get().settings.info.distance).toBe(false);
  expect(read).toHaveBeenCalledTimes(1);
  for (const geometry of ['LineString', 'gx:Track'] as const) {
    for (const nights of [2, 9, 10, 12]) {
      const parsed = parseRouteText('mixed.kml', organicMixed(nights, true, geometry));
      if (!parsed.ok) throw new Error(parsed.error);
      expect(createImportChoice(parsed.tracks)?.selected).toBe(nights >= 10 ? 'waypoints' : 'track');
      // Старый buildRoute сохраняет приоритет линии независимо от выбора в UI.
      const legacy = buildRoute(parsed.tracks);
      if ('error' in legacy) throw new Error(legacy.error);
      expect(legacy.points.map((p) => p.lon)).toEqual([10, 10.01]);
    }
  }
  for (const xml of [organicMixed(12, false), organicMixed(0), organicMixed().replace(/<Placemark><name>Private walk<\/name>.*?<\/Placemark>/, '')]) {
    const parsed = parseRouteText('single.kml', xml);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(createImportChoice(parsed.tracks)).toBeNull();
  }
});

import { expect, it } from 'vitest';
import * as importer from '../../src/ui/step-route';
import { createStore } from '../../src/ui/state';
import { organicArchive } from '../fixtures/synthetic/organic-archive';
import { buildTimeline, matchChapters } from '../../src/story';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import { drawOverlay } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { recorder } from '../render/overlay-recorder';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';

it('неоднозначный архив не даёт маршрута до явного подтверждения участка', async () => {
  const store = createStore();
  await importer.importText(store, 'synthetic.kml', organicArchive());
  expect(store.get().route).toBeNull();
  expect(store.get().enrichment).toBeNull();
  expect(store.get().source?.files).toEqual(['synthetic.kml']);
  const archive = store.get().source!.waypointArchive!;
  const original = JSON.stringify(archive.tracks);
  archive.chapters = [{ id: 'outside', title: { ru: 'Исключённая глава', en: 'Excluded chapter' },
    text: { ru: 'Не показывать', en: 'Do not show' }, mood: 'cold', source: 'traveler', finale: true,
    anchor: { countries: ['AT'], markedAt: { from: Date.UTC(2026, 9, 11), to: Date.UTC(2026, 9, 13) } } }];
  importer.confirmWaypointSelection(store, { from: Date.UTC(2025, 0, 1), to: Date.UTC(2025, 0, 3) - 1 });
  const route = store.get().route!;
  expect(route.points.map(p => p.lon)).toEqual([2.3, 2.3099999999999996]);
  expect(route.importReport).toMatchObject({ unique: 4, included: 2 });
  const geo = createGeoIndex(JSON.parse(countriesRaw), JSON.parse(placesRaw));
  const enrichment = enrichRoute(route, geo);
  expect(enrichment.countries.map(c => c.iso2)).toEqual(['FR']);
  expect(matchChapters(route, enrichment)).toEqual([]);
  const timeline = buildTimeline(route, enrichment, store.get().settings);
  for (const t of [2, 10, 20, 28]) {
    const rec = recorder(), frame = timeline.frameAt(t);
    drawOverlay(rec.ctx, frame, { route, enrichment, settings: store.get().settings, style: STYLES.epic, reconstruction: false });
    expect(rec.texts.join(' ')).not.toMatch(/Австрия|Austria|Исключённая глава|Excluded chapter/);
    expect(frame.headLonLat[0]).toBeLessThan(3);
  }
  expect(JSON.stringify(archive.tracks)).toBe(original);
});

it('короткий Organic Maps с прочими цветами сохраняет архив для обратимого включения исключённых закладок', async () => {
  const store = createStore();
  const xml = `<kml><Document>${['green', 'red', 'brown', 'pink'].map((color, i) =>
    `<Placemark><name>synthetic-${i}</name><styleUrl>#placemark-${color}</styleUrl><Point><coordinates>${30 + i},40</coordinates></Point></Placemark>`).join('')}</Document></kml>`;
  await importer.importText(store, 'synthetic.kml', xml);
  expect(store.get().route?.points).toHaveLength(2);
  expect(store.get().route?.importReport?.excludedOtherColors).toBe(2);
  expect(store.get().source?.waypointArchive?.tracks[0].kmlImport?.points).toHaveLength(4);
  importer.confirmWaypointSelection(store, { includeOtherColors: true });
  expect(store.get().route?.points).toHaveLength(4);
  expect(store.get().route?.importReport?.excludedOtherColors).toBe(0);
  importer.confirmWaypointSelection(store, { includeOtherColors: false });
  expect(store.get().route?.points).toHaveLength(2);
});

it('архив только с прочими цветами открывает выбор, а не теряется из-за пустого маршрута', async () => {
  const store = createStore();
  const xml = `<kml><Document>${['brown', 'pink'].map((color, i) =>
    `<Placemark><styleUrl>#placemark-${color}</styleUrl><Point><coordinates>${30 + i},40</coordinates></Point></Placemark>`).join('')}</Document></kml>`;
  await importer.importText(store, 'synthetic.kml', xml);
  expect(store.get().status.phase).toBe('idle');
  expect(store.get().route).toBeNull();
  expect(store.get().source?.waypointArchive?.tracks[0].kmlImport?.points).toHaveLength(2);
  importer.confirmWaypointSelection(store, { includeOtherColors: true });
  expect(store.get().route?.points).toHaveLength(2);
});

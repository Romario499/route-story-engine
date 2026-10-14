import { expect, it } from 'vitest';
import { drawOverlay, resolveTitle } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { buildTimeline } from '../../src/story';
import { enrichmentFor, settings } from '../story/fixtures';
import { jw, waypointRoute } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';
import type { CameraState, Country, Enrichment } from '../../src/types';
import { overviewLabels } from '../../src/story/legs';

const west: Country = { iso2: 'AA', nameRu: 'Запад', nameEn: 'West' };
const east: Country = { iso2: 'BB', nameRu: 'Восток', nameEn: 'East' };
const route = waypointRoute([jw(0, 0, 'overnight', 0), jw(0, 1, 'overnight', 1), jw(0, 30, 'overnight', 2)]);
const e: Enrichment = { ...enrichmentFor(route), countries: [east, west],
  countryAt: i => i < 2 ? west : east,
  placeAt: i => ({ lat: 0, lon: route.points[i].lon, nameRu: `Город ${i}`, nameEn: `City ${i}`, pop: 1000 }) };

it('область обзора: две страны — группа без города; одна — её плашка и город ближайшей видимой метки; пустой кадр — без них', () => {
  for (const format of ['9:16', '16:9'] as const) for (const lang of ['ru', 'en'] as const) {
    const s = settings({ format, lang, info: { ...settings().info, city: true } });
    const base = buildTimeline(route, e, s).frameAt(10);
    const full = buildTimeline(route, e, s).frameAt(0);
    expect(full.stats.country).toBeNull();
    expect(full.stats.place).toBeNull();
    const render = (camera: CameraState) => {
      const rec = recorder();
      drawOverlay(rec.ctx, { ...base, camera }, { route, enrichment: e, settings: s, style: STYLES.epic, reconstruction: false });
      return rec.texts;
    };
    const wide = render({ center: [15, 0], zoom: 3, pitch: 0, bearing: 0 });
    expect(wide).toContain(lang === 'ru' ? '2 страны' : '2 countries');
    expect(wide.join(' ')).not.toMatch(/Город|City|Запад|Восток|West|East/);
    const close = render({ center: [1, 0], zoom: 8, pitch: 0, bearing: 0 });
    expect(close).toContain(lang === 'ru' ? 'Запад' : 'West');
    expect(close).toContain(lang === 'ru' ? 'Город 1' : 'City 1');
    expect(close.join(' ')).not.toMatch(/Восток|East|Город 0|City 0/);
    const camera: CameraState = { center: [1, 0], zoom: 8, pitch: 0, bearing: 0 };
    const viewport = format === '9:16' ? { width: 540, height: 960 } : { width: 960, height: 540 };
    expect(overviewLabels(route, { ...e, placeAt: () => null }, camera, viewport).place).toBeNull();
    expect(overviewLabels(route, { ...e, countryAt: i => i === 0 ? null : west }, { ...camera, zoom: 7 }, viewport).country).toBeNull();
    const empty = render({ center: [90, 0], zoom: 8, pitch: 0, bearing: 0 });
    expect(empty.join(' ')).not.toMatch(/страны|countries|Город|City|Запад|Восток|West|East/);
  }
});

it('титр обзора сортирует страны по долготе центроидов меток, без стрелок и без стран вне набора', () => {
  for (const lang of ['ru', 'en'] as const) {
    expect(resolveTitle(lang, '', route, e)).toBe(lang === 'ru' ? 'Запад · Восток' : 'West · East');
    // Первый элемент страны лежит восточнее B, но центроид A западнее B: сортировка не по первой метке.
    const spread = waypointRoute([jw(0, 20, 'overnight', 0), jw(0, 0, 'overnight', 1), jw(0, 15, 'overnight', 2)]);
    expect(resolveTitle(lang, '', spread, e)).toBe(lang === 'ru' ? 'Запад · Восток' : 'West · East');
    expect(resolveTitle(lang, '', route, { ...e, countryAt: () => null })).toBe(lang === 'ru' ? 'обзор по меткам' : 'waypoint overview');
  }
});

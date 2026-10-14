import { expect, it } from 'vitest';
import { buildTimeline, journeyFacts } from '../../src/story';
import { jw, waypointRoute } from './waypoint-fixtures';
import { enrichmentFor, settings } from './fixtures';
import type { Country, Enrichment } from '../../src/types';
import { drawOverlay, resolveTitle } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { recorder } from '../render/overlay-recorder';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';

it('обзор не утверждает порядок визитов, не переставляет метки и называет набор стран', () => {
  const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 40, 'overnight', 1), jw(40, 30.1, 'overnight', 2), jw(40, 40.1, 'overnight', 3)]);
  const a: Country = { iso2: 'AA', nameRu: 'А', nameEn: 'A' }, b: Country = { iso2: 'BB', nameRu: 'Б', nameEn: 'B' };
  const base = enrichmentFor(route);
  const e: Enrichment = { ...base, countries: [a, b], countryAt: i => [a, b, a, b][i],
    countryRuns: [a, b, a, b].map((country, i) => ({ fromIdx: i, toIdx: i, country })) };
  const timeline = buildTimeline(route, e, settings());
  const withChapters = { ...route, chapters: [{ id: 'synthetic', title: { ru: 'Глава', en: 'Chapter' },
    text: { ru: 'История', en: 'Story' }, mood: 'cold' as const, source: 'traveler' as const,
    anchor: { countries: ['AA', 'BB'] }, finale: true }] };
  const chapterTimeline = buildTimeline(withChapters, e, settings());
  const sequence: string[] = [];
  for (let t = 3; t <= 30; t += 1 / 30) {
    const frame = timeline.frameAt(t), rec = recorder();
    expect(chapterTimeline.frameAt(t)).toEqual(frame);
    drawOverlay(rec.ctx, frame, { route, enrichment: e, settings: settings(), style: STYLES.epic, reconstruction: false });
    const c = rec.texts.find(s => s.includes(' → '));
    if (c && sequence.at(-1) !== c) sequence.push(c);
  }
  expect(sequence).toEqual([]);
  const reversed: Enrichment = { ...e, countryAt: i => [b, a, b, a][i],
    countryRuns: [b, a, b, a].map((country, i) => ({ fromIdx: i, toIdx: i, country })) };
  expect(resolveTitle('ru', '', route, reversed)).toBe('Б · А');
  expect(route.journeyWaypoints).toHaveLength(4);
  expect(route.points.map(p => p.lon)).toEqual([30, 40, 30.1, 40.1]);
});

it('подтверждённый возврат A → B → A по времени создания показывает три плашки без глав', () => {
  const route = waypointRoute([jw(40, 40, 'overnight', 1), jw(40, 30.1, 'overnight', 2), jw(40, 30, 'overnight', 0)]);
  route.waypointOrderConfirmed = true;
  const a: Country = { iso2: 'AA', nameRu: 'А', nameEn: 'A' }, b: Country = { iso2: 'BB', nameRu: 'Б', nameEn: 'B' };
  const countries = [a, b, a];
  const e: Enrichment = { ...enrichmentFor(route), countries: [a, b], placeAt: () => null,
    countryAt: i => countries[i], countryRuns: countries.map((country, i) => ({ fromIdx: i, toIdx: i, country })),
    beats: [{ kind: 'start', idx: 0 }, { kind: 'country', idx: 1, country: b },
      { kind: 'country', idx: 2, country: a }, { kind: 'finish', idx: 2 }] };
  for (const lang of ['ru', 'en'] as const) for (const durationSec of [15, 30] as const) {
    const s = settings({ lang, durationSec }), timeline = buildTimeline(route, e, s), sequence: string[] = [];
    const expected = lang === 'ru' ? ['А', 'Б', 'А'] : ['A', 'B', 'A'];
    for (let i = 0; i <= timeline.frameCount; i++) {
      const frame = timeline.frameAt(i / 30), rec = recorder();
      drawOverlay(rec.ctx, frame, { route, enrichment: e, settings: s, style: STYLES.epic, reconstruction: false });
      const country = rec.texts.find(text => expected.includes(text));
      if (country && sequence.at(-1) !== country) sequence.push(country);
    }
    expect(sequence, `${lang}/${durationSec}`).toEqual(expected);
  }
  expect(route.points.map(p => p.lon)).toEqual([30, 40, 30.1]);
});

it('подтверждённая последовательность: реальные страны и города, на связи нет утверждения о городе', () => {
  // Общедоступные центры городов, синтетическая история; названия из реальной базы public/data.
  const realGeo = createGeoIndex(JSON.parse(countriesRaw), JSON.parse(placesRaw));
  const cityRoute = waypointRoute([jw(41.7151, 44.8271, 'overnight', 0), jw(40.1792, 44.5086, 'overnight', 1)]);
  cityRoute.waypointOrderConfirmed = true;
  const real = enrichRoute(cityRoute, realGeo);
  expect(real.countryAt(0)?.iso2).toBe('GE');
  expect(real.countryAt(1)?.iso2).toBe('AM');
  expect(real.placeAt(0)?.nameRu).toBe('Тбилиси');
  expect(real.placeAt(1)?.nameRu).toBe('Ереван');
  for (const lang of ['ru', 'en'] as const) {
    const s = settings({ lang, info: { ...settings().info, city: true } });
    const timeline = buildTimeline(cityRoute, real, s);
    const end = timeline.frameAt(30), rec = recorder();
    drawOverlay(rec.ctx, end, { route: cityRoute, enrichment: real, settings: s, style: STYLES.epic, reconstruction: false });
    expect(end.stats.place).toEqual(real.placeAt(1));
    let sawHop = false;
    for (let t = 7; t < 26; t += 0.1) {
      const frame = timeline.frameAt(t);
      if (frame.head > 0 && frame.head < 1) {
        sawHop = true;
        expect(frame.stats.country).toBeNull(); expect(frame.stats.place).toBeNull();
      }
    }
    expect(sawHop).toBe(true);
  }
});

it('обзор не выводит начало/конец поездки из крайних элементов хранения', () => {
  const route = waypointRoute([jw(48.8566, 2.3522, 'overnight', 3), jw(48.2082, 16.3738, 'overnight', 1),
    jw(48.8576, 2.3532, 'overnight', 2), jw(48.2092, 16.3748, 'overnight', 0)]);
  expect(route.points.map(p => p.lon)).toEqual([16.3748, 16.3738, 2.3532, 2.3522]);
  const geo = createGeoIndex(JSON.parse(countriesRaw), JSON.parse(placesRaw)), e = enrichRoute(route, geo);
  for (const lang of ['ru', 'en'] as const) {
    const s = settings({ lang }), timeline = buildTimeline(route, e, s);
    for (let t = 0; t <= 30; t += 0.1) {
      const frame = timeline.frameAt(t), rec = recorder();
      expect(Number.isInteger(frame.head)).toBe(true);
      expect(frame.headLonLat).toEqual([route.points[frame.head].lon, route.points[frame.head].lat]);
      expect(frame.cards).toEqual([]);
      expect(frame.showFinish).toBe(false);
      drawOverlay(rec.ctx, frame, { route, enrichment: e, settings: s, style: STYLES.epic, reconstruction: false });
      expect(rec.texts.join(' ')).not.toMatch(/Старт|Финиш|\bStart\b|\bFinish\b/i);
    }
  }
});

it('подтверждённый режим называет начало и конец поездки; обзор не выдаёт индекс за число меток', () => {
  const route = waypointRoute([jw(40, 30, 'overnight', 2), jw(41, 31, 'overnight', 0), jw(40, 32, 'overnight', 1)]);
  const e = enrichmentFor(route), s = settings({ info: { ...settings().info, day: true } });
  const overview = recorder();
  drawOverlay(overview.ctx, buildTimeline(route, e, s).frameAt(10), { route, enrichment: e, settings: s, style: STYLES.epic, reconstruction: false });
  expect(overview.texts).toContain('3');
  route.waypointOrderConfirmed = true;
  const timeline = buildTimeline(route, e, s), texts: string[] = [];
  for (let i = 0; i <= timeline.frameCount; i++) {
    const rec = recorder();
    drawOverlay(rec.ctx, timeline.frameAt(i / 30), { route, enrichment: e, settings: s, style: STYLES.epic, reconstruction: false });
    texts.push(...rec.texts);
  }
  expect(texts.some(text => /^Старт/i.test(text))).toBe(true);
  expect(texts.some(text => /^Финиш/i.test(text))).toBe(true);
});

it('статистика считает различные места ночёвок, включая недатированные, без дней поездки', () => {
  const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 30, 'overnight', 365), jw(40, 30.0006, 'overnight'), jw(40, 31, 'stop', 1)]);
  const facts = journeyFacts(route)!;
  expect(facts.nightsTotal).toBe(2);
  expect(facts.days).toBeUndefined();
  expect(facts.markDays).toBeUndefined();
  for (const lang of ['ru', 'en'] as const) {
    const s = settings({ lang, info: { ...settings().info, day: true, progress: true } });
    const e = enrichmentFor(route), rec = recorder();
    const frame = buildTimeline(route, e, s).frameAt(30);
    drawOverlay(rec.ctx, frame, { route, enrichment: e, settings: s, style: STYLES.epic, reconstruction: false });
    expect(rec.texts.join(' ')).not.toMatch(/дн[яе]|день|\bday|\bnights?\b/i);
    expect(rec.texts.join(' ')).toMatch(lang === 'ru' ? /мест[ао]? ночёвок/i : /overnight places/i);
  }
});

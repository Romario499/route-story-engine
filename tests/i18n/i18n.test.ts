import { RU, EN } from '../../src/i18n/messages';
import { describe, expect, it } from 'vitest';
import {
  OVERLAY_KEYS, attributionText, beatTitle, countryName, formatAltitude, formatDate, formatDateRange, formatDistance, formatSpeed,
  placeName, t, transportKicker, transportTitle,
} from '../../src/i18n';
import type { Beat, Country, Lang, Place, TransportChange } from '../../src/types';
import { STYLES } from '../../src/render/styles';

const LANGS: Lang[] = ['ru', 'en'];
const georgia: Country = { iso2: 'GE', nameRu: 'Грузия', nameEn: 'Georgia' };
const batumi: Place = { nameRu: 'Батуми', nameEn: 'Batumi', lat: 41.64, lon: 41.63, pop: 150_000 };
const may12 = Date.UTC(2024, 4, 12, 10, 0, 0);

describe('i18n — ключи', () => {
  it.each(LANGS)('%s: атрибуция сохраняет прежний текст, ссылки и пояснение об изменении цвета', lang => {
    const source = 'EOxCloudless 2016 https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017), CC BY 4.0 https://creativecommons.org/licenses/by/4.0/';
    const providers = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap · Terrain Tiles on AWS (SRTM, USGS, NOAA, Copernicus EU-DEM)';
    expect(attributionText(lang, STYLES.epic.attribution)).toBe(
      `${source}, ${lang === 'ru' ? 'цвет изменён' : 'colour adjusted'} · ${providers}`,
    );
    expect(attributionText(lang, 'Provider · ДАННЫЕ / данные')).toBe(lang === 'ru' ? 'Provider · ДАННЫЕ / данные' : 'Provider · data / data');
  });
  it('разрыв: неизвестный путь и расстояние между концами, RU/EN', () => {
    expect(t('ru', 'gap.unknown')).toBe('Разрыв записи · путь неизвестен');
    expect(t('en', 'gap.unknown')).toBe('Recording gap · path unknown');
    expect(t('ru', 'summary.recordedDistance')).toBe('по записанным участкам');
    expect(t('en', 'summary.recordedDistance')).toBe('along recorded sections');
    expect(t('ru', 'summary.gapStraight', { km: '721 км' })).toBe('разрыв ≈ 721 км по прямой');
    expect(t('en', 'summary.gapStraight', { km: '721 km' })).toBe('gap ≈ 721 km in a straight line');
  });
  it('все тексты ролика есть и в ru, и в en, непустые и с одинаковыми подстановками', () => {
    // обязательные ключи из приёмки: подписи элементов, Старт/Финиш/Высшая точка/День, итог, «реконструкция маршрута»
    const required = [
      'label.distance', 'label.day', 'label.date', 'label.country', 'label.city', 'label.altitude', 'label.speed',
      'label.profile', 'label.progress', 'beat.start', 'beat.finish', 'beat.peak', 'day', 'summary.distance',
      'summary.days', 'summary.countries', 'summary.maxAltitude', 'note.reconstruction',
      // второй заход: нейтральные разрывы, «рядом», пометка расчётных значений, названия стилей
      'gap', 'summary.byTrack', 'summary.gaps', 'label.nearby', 'mark.estimated', 'style.epic', 'style.atlas', 'style.neon',
    ];
    for (const k of required) expect(OVERLAY_KEYS).toContain(k);
    const vars = { n: 5, place: 'X', value: 'Y', km: 'Z' };
    for (const key of OVERLAY_KEYS) {
      const ru = t('ru', key, vars);
      const en = t('en', key, vars);
      expect(ru.trim(), `ru:${key}`).not.toBe('');
      expect(en.trim(), `en:${key}`).not.toBe('');
      expect(ru, `ru:${key}`).not.toMatch(/\{\w+\}/);
      expect(en, `en:${key}`).not.toMatch(/\{\w+\}/);
    }
  });

  it('тексты по языку', () => {
    expect(t('ru', 'beat.start')).toBe('Старт');
    expect(t('en', 'beat.start')).toBe('Start');
    expect(t('ru', 'beat.finish')).toBe('Финиш');
    expect(t('en', 'beat.peak')).toBe('Highest point');
    expect(t('ru', 'beat.peak')).toBe('Высшая точка');
    expect(t('ru', 'day', { n: 3 })).toBe('День 3');
    expect(t('en', 'day', { n: 3 })).toBe('Day 3');
    expect(t('ru', 'note.reconstruction')).toBe('реконструкция маршрута');
    expect(t('en', 'note.reconstruction')).toBe('route reconstruction');
  });

  it('второй заход: разрыв трека без «парома», «рядом», «расчётно», названия стилей', () => {
    expect([t('ru', 'gap'), t('en', 'gap')]).toEqual(['разрыв трека', 'track gap']);
    expect([t('ru', 'label.nearby'), t('en', 'label.nearby')]).toEqual(['рядом', 'nearby']);
    expect([t('ru', 'mark.estimated'), t('en', 'mark.estimated')]).toEqual(['расчётно', 'estimated']);
    expect([t('ru', 'style.epic'), t('ru', 'style.atlas'), t('ru', 'style.neon')]).toEqual(['Экспедиция', 'Атлас', 'Неон']);
    expect([t('en', 'style.epic'), t('en', 'style.atlas'), t('en', 'style.neon')]).toEqual(['Expedition', 'Atlas', 'Neon']);
    expect(t('ru', 'summary.byTrack', { km: '5 000 км' })).toBe('по треку 5 000 км');
    expect(t('ru', 'summary.gaps', { km: '144 км' })).toBe('разрывы 144 км');
    expect(t('en', 'summary.byTrack', { km: '5,000 km' })).toBe('along the track 5,000 km');
    expect(t('en', 'summary.gaps', { km: '144 km' })).toBe('gaps 144 km');
    // подписи разрыва не называют способ передвижения
    for (const lang of LANGS) for (const key of ['gap', 'summary.gaps', 'summary.byTrack'] as const) {
      expect(t(lang, key, { km: '1' }).toLowerCase()).not.toMatch(/паром|перел[её]т|ferry|flight|own power|своим ходом/);
    }
  });

  it('множественное число в итоге', () => {
    expect(t('ru', 'summary.days', { n: 1 })).toBe('день');
    expect(t('ru', 'summary.days', { n: 3 })).toBe('дня');
    expect(t('ru', 'summary.days', { n: 12 })).toBe('дней');
    expect(t('ru', 'summary.countries', { n: 21 })).toBe('страна');
    expect(t('en', 'summary.days', { n: 1 })).toBe('day');
    expect(t('en', 'summary.days', { n: 2 })).toBe('days');
    expect(t('en', 'summary.countries', { n: 9 })).toBe('countries');
  });
});

describe('i18n — форматы', () => {
  it('formatDistance по локали', () => {
    expect(formatDistance('ru', 12.34)).toMatch(/^12,3\sкм$/);
    expect(formatDistance('en', 12.34)).toMatch(/^12\.3\skm$/);
    expect(formatDistance('ru', 1234.5)).toMatch(/^1\s235\sкм$/);
    expect(formatDistance('en', 1234.5)).toMatch(/^1,235\skm$/);
  });

  it('formatAltitude и formatSpeed', () => {
    expect(formatAltitude('ru', 3120.4)).toMatch(/^3\s120\sм$/);
    expect(formatAltitude('en', 3120.4)).toMatch(/^3,120\sm$/);
    expect(formatSpeed('ru', 54.6)).toMatch(/^55\sкм\/ч$/);
    expect(formatSpeed('en', 54.6)).toMatch(/^55\skm\/h$/);
  });

  it('formatDate по локали (UTC)', () => {
    expect(formatDate('ru', may12)).toBe('12 мая 2024');
    expect(formatDate('en', may12)).toBe('12 May 2024');
  });

  it('formatDateRange: один месяц, один год, разные годы, один день', () => {
    const may1 = Date.UTC(2024, 4, 1);
    const apr28 = Date.UTC(2024, 3, 28);
    const jan3 = Date.UTC(2025, 0, 3);
    expect(formatDateRange('ru', may1, may12)).toBe('1–12 мая 2024');
    expect(formatDateRange('en', may1, may12)).toBe('1–12 May 2024');
    expect(formatDateRange('ru', apr28, may12)).toBe('28 апреля – 12 мая 2024');
    expect(formatDateRange('en', apr28, may12)).toBe('28 April – 12 May 2024');
    expect(formatDateRange('ru', may12, jan3)).toBe('12 мая 2024 – 3 января 2025');
    expect(formatDateRange('en', may12, may12 + 3600_000)).toBe('12 May 2024');
  });

  it('countryName / placeName по языку', () => {
    expect(countryName('ru', georgia)).toBe('Грузия');
    expect(countryName('en', georgia)).toBe('Georgia');
    expect(placeName('ru', batumi)).toBe('Батуми');
    expect(placeName('en', batumi)).toBe('Batumi');
    // нет русского имени — английское
    expect(placeName('ru', { ...batumi, nameRu: '' })).toBe('Batumi');
  });

  it('beatTitle: тексты битов по языку', () => {
    const cases: [Beat, string, string][] = [
      [{ kind: 'start', idx: 0, place: batumi }, 'Старт — Батуми', 'Start — Batumi'],
      [{ kind: 'start', idx: 0, place: null }, 'Старт', 'Start'],
      [{ kind: 'country', idx: 5, country: georgia }, 'Грузия', 'Georgia'],
      [{ kind: 'peak', idx: 7, ele: 2400 }, 'Высшая точка — 2 400 м', 'Highest point — 2,400 m'],
      [{ kind: 'waypoint', idx: 8, label: 'Перевал' }, 'Перевал', 'Перевал'],
      [{ kind: 'finish', idx: 9, place: batumi }, 'Финиш — Батуми', 'Finish — Batumi'],
    ];
    for (const [beat, ru, en] of cases) {
      expect(beatTitle('ru', beat).replace(/\s/g, ' ')).toBe(ru.replace(/\s/g, ' '));
      expect(beatTitle('en', beat).replace(/\s/g, ' ')).toBe(en.replace(/\s/g, ' '));
    }
    for (const lang of LANGS) expect(beatTitle(lang, { kind: 'peak', idx: 1 })).not.toBe('');
  });
});

describe('i18n — маршрут по меткам (ADR 0010)', () => {
  it('постоянная подпись кадра: «маршрут по меткам, не GPS-трек» на двух языках', () => {
    expect(t('ru', 'note.waypoints')).toBe('маршрут по меткам, не GPS-трек');
    expect(t('en', 'note.waypoints')).toMatch(/waypoints/i);
    expect(t('en', 'note.waypoints')).toMatch(/not a GPS track/i);
  });

  it('смена транспорта: поезд, уницикл — только как предположение, неизвестный способ', () => {
    const change = (kind: TransportChange['kind'], confidence: TransportChange['confidence']): TransportChange => ({ kind, confidence, fromIdx: 0, toIdx: 1 });
    expect(transportTitle('ru', change('train', 'stated'))).toBe('Поезд');
    expect(transportTitle('en', change('train', 'stated'))).toBe('Train');
    expect(transportTitle('ru', change('unicycle', 'inferred'))).toMatch(/предположительно/);
    expect(transportTitle('en', change('unicycle', 'inferred'))).toMatch(/inferred/);
    expect(transportTitle('ru', change('unknown', 'unknown'))).toBe('Следующий участок');
    expect(transportTitle('en', change('unknown', 'unknown'))).toBe('Next leg');
    expect(transportKicker('ru', change('unknown', 'unknown'))).toBe('Способ неизвестен');
    expect(transportKicker('en', change('unknown', 'unknown'))).toBe('Mode unknown');
    expect(transportKicker('ru', change('train', 'stated'))).toBe('Смена транспорта');
    expect(t('ru', 'transport.change')).toBe('Смена транспорта');
  });

  it('склонение мест ночёвки в итогах: 1/21/161 место, 2 места, 5/11/12 мест — всегда «ночёвки»', () => {
    const f = (n: number) => `${n} ${t('ru', 'summary.overnightPlaces', { n })}`;
    expect([1, 2, 5, 11, 12, 21, 22, 161].map(f)).toEqual(['1 место ночёвки', '2 места ночёвки', '5 мест ночёвки', '11 мест ночёвки',
      '12 мест ночёвки', '21 место ночёвки', '22 места ночёвки', '161 место ночёвки']);
    expect([1, 5].map((n) => t('en', 'summary.overnightPlaces', { n }))).toEqual(['overnight place', 'overnight places']);
  });

  it('подтверждение импорта: метки и места ночёвки склоняются (1/2/5/11/21/22)', () => {
    const f = (n: number, nights: number) => t('ru', 'import.confirm', { n, nights });
    expect(f(1, 1)).toBe('Подтвердить: 1 метка, 1 место ночёвки');
    expect(f(2, 2)).toBe('Подтвердить: 2 метки, 2 места ночёвки');
    expect(f(5, 5)).toBe('Подтвердить: 5 меток, 5 мест ночёвки');
    expect(f(11, 12)).toBe('Подтвердить: 11 меток, 12 мест ночёвки');
    expect(f(21, 22)).toBe('Подтвердить: 21 метка, 22 места ночёвки');
    expect(t('en', 'import.confirm', { n: 1, nights: 1 })).toBe('Confirm: 1 waypoint, 1 overnight place');
    expect(t('en', 'import.confirm', { n: 2, nights: 5 })).toBe('Confirm: 2 waypoints, 5 overnight places');
  });

  it('склонение ночёвок', () => {
    expect([1, 3, 5, 21].map((n) => t('ru', 'summary.nights', { n }))).toEqual(['ночёвка', 'ночёвки', 'ночёвок', 'ночёвка']);
    expect([1, 2].map((n) => t('en', 'summary.nights', { n }))).toEqual(['night', 'nights']);
  });

  it('неиспользуемые ключи неподтверждённого километража удалены из обоих словарей', () => {
    expect(Object.keys(RU)).not.toContain('label.straight');
    expect(Object.keys(RU)).not.toContain('summary.straight');
    expect(Object.keys(EN)).not.toContain('label.straight');
    expect(Object.keys(EN)).not.toContain('summary.straight');
  });
});

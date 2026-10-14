import { describe, expect, it } from 'vitest';
import { beatCaption, fitTitle, layoutTitle, localizeAuthor, resolveTitle, titleFits } from '../../src/render/overlay';
import type { Beat, Country, Enrichment, Place, Route } from '../../src/types';
import { enrichmentFor, lineRoute } from '../story/fixtures';

const CYRILLIC = /[\u0400-\u04FF]/;
const country = (iso2: string, nameRu: string, nameEn: string): Country => ({ iso2, nameRu, nameEn });
const TR = country('TR', 'Турция', 'Turkey');
const CN = country('CN', 'Китай', 'China');
const KZ = country('KZ', 'Казахстан', 'Kazakhstan');

function enrichmentWith(runs: (Country | null)[]): Enrichment {
  const e = enrichmentFor(lineRoute(30));
  return {
    ...e,
    countryRuns: runs.map((c, i) => ({ fromIdx: i * 5, toIdx: i * 5 + 4, country: c })),
    countries: runs.filter((c): c is Country => c !== null),
  };
}

describe('заголовок по умолчанию', () => {
  const route = lineRoute(30);
  it('«<страна старта> → <страна финиша>» по языку', () => {
    const e = enrichmentWith([TR, KZ, CN]);
    expect(resolveTitle('ru', '', route, e)).toBe('Турция → Китай');
    expect(resolveTitle('en', '', route, e)).toBe('Turkey → China');
  });
  it('заголовок пользователя главнее', () => {
    expect(resolveTitle('ru', '  Мой Кавказ ', route, enrichmentWith([TR, CN]))).toBe('Мой Кавказ');
  });
  it('одна страна — её название; страны не определены — имя в файле, иначе «Моё путешествие»', () => {
    expect(resolveTitle('en', '', route, enrichmentWith([TR]))).toBe('Turkey');
    expect(resolveTitle('en', '', route, enrichmentWith([null]))).toBe('My journey');
    const named: Route = { ...route, name: 'Alps loop' };
    expect(resolveTitle('en', '', named, enrichmentWith([null]))).toBe('Alps loop');
    expect(resolveTitle('ru', '', route, null)).toBe('Моё путешествие');
  });
  it('одна страна: заголовок — имя трека из файла, а без него — страна', () => {
    const named: Route = { ...route, name: 'Кольцо вокруг Эльбруса' };
    expect(resolveTitle('ru', '', named, enrichmentWith([TR]))).toBe('Кольцо вокруг Эльбруса');
    expect(resolveTitle('ru', '', { ...route, name: '  ' }, enrichmentWith([TR]))).toBe('Турция');
    expect(resolveTitle('ru', '', named, enrichmentWith([TR, TR]))).toBe('Кольцо вокруг Эльбруса');
    // несколько стран — по-прежнему «откуда → куда», имя трека не перекрывает
    expect(resolveTitle('ru', '', named, enrichmentWith([TR, CN]))).toBe('Турция → Китай');
    // свой заголовок главнее имени трека
    expect(resolveTitle('ru', 'Мой', named, enrichmentWith([TR]))).toBe('Мой');
  });
  it('длинные официальные названия сокращаются: «Китайская Народная Республика» → «Китай»', () => {
    const cn = country('CN', 'Китайская Народная Республика', "People's Republic of China");
    const e = enrichmentWith([TR, cn]);
    expect(resolveTitle('ru', '', route, e)).toBe('Турция → Китай');
    expect(resolveTitle('en', '', route, e)).toBe('Turkey → China');
  });
  it('в EN-пример (@wahrier) получается «Turkey → China» без кириллицы', () => {
    expect(CYRILLIC.test(resolveTitle('en', '', route, enrichmentWith([TR, CN])))).toBe(false);
  });
});

describe('подпись автора', () => {
  it('подпись примера переводится вместе с языком ролика', () => {
    expect(localizeAuthor('en', '@wahrier · реконструкция маршрута')).toBe('@wahrier · route reconstruction');
    expect(localizeAuthor('ru', '@wahrier · route reconstruction')).toBe('@wahrier · реконструкция маршрута');
  });
  it('чужую подпись не трогает', () => {
    expect(localizeAuthor('en', '  @ivan  ')).toBe('@ivan');
  });
});

describe('подпись бита', () => {
  const route = lineRoute(30);
  const near: Place = { nameRu: 'Тбилиси', nameEn: 'Tbilisi', lat: route.points[10].lat, lon: route.points[10].lon + 0.01, pop: 1 };
  const far: Place = { nameRu: 'Ереван', nameEn: 'Yerevan', lat: route.points[10].lat + 0.3, lon: route.points[10].lon, pop: 1 };
  const wp = (place: Place | null, label = 'Тбилиси-центр'): Beat => ({ kind: 'waypoint', idx: 10, label, place });

  it('остановка рядом с населённым пунктом называется по нему и на языке ролика', () => {
    expect(beatCaption('en', wp(near), route).title).toBe('Tbilisi');
    expect(beatCaption('ru', wp(near), route).title).toBe('Тбилиси');
  });
  it('далеко от города — название из файла; в EN кириллица не просачивается', () => {
    expect(beatCaption('ru', wp(far), route).title).toBe('Тбилиси-центр');
    const en = beatCaption('en', wp(far), route).title;
    expect(CYRILLIC.test(en)).toBe(false);
    expect(en).toMatch(/^Tbilisi/);
  });
  it('старт и финиш: заголовок «Старт», название — отдельной строкой', () => {
    const start: Beat = { kind: 'start', idx: 0, place: near, country: TR };
    expect(beatCaption('ru', start, route)).toMatchObject({ kicker: 'Старт', title: 'Тбилиси' });
    expect(beatCaption('en', { ...start, kind: 'finish' }, route)).toMatchObject({ kicker: 'Finish', title: 'Tbilisi' });
  });
  it('пик — высота в метрах', () => {
    const c = beatCaption('en', { kind: 'peak', idx: 5, ele: 3120 }, route);
    expect(c.kicker).toBe('Highest point');
    expect(c.title.replace(/\u00a0/g, ' ')).toBe('3,120 m');
  });
});

describe('layoutTitle: заголовок не переносится некрасиво', () => {
  // каждая буква — 0,6 кегля; стрелка и пробел считаются так же
  const measure = (s: string, size: number) => s.length * size * 0.6;

  it('короткий — одной строкой максимального кегля', () => {
    const r = layoutTitle('Alps', measure, 800, 3, 100, 30);
    expect(r.lines).toEqual(['Alps']);
    expect(r.size).toBe(100);
  });
  it('«Турция → Китай» не рвёт стрелку: стрелка остаётся с правым словом', () => {
    const r = layoutTitle('Турция → Китай', measure, 700, 2, 120, 30);
    expect(r.lines.length).toBeLessThanOrEqual(2);
    if (r.lines.length === 2) expect(r.lines[1].startsWith('→')).toBe(true);
    for (const line of r.lines) expect(measure(line, r.size)).toBeLessThanOrEqual(700 + 0.5);
  });
  it('длинный — переносится по словам, строки влезают, число строк не больше предела', () => {
    const r = layoutTitle('Большое путешествие на велосипеде через всю Среднюю Азию', measure, 800, 3, 110, 30);
    expect(r.lines.length).toBeLessThanOrEqual(3);
    for (const line of r.lines) expect(measure(line, r.size)).toBeLessThanOrEqual(800 + 0.5);
    expect(r.lines.join(' ').replace(/\u00a0/g, ' ')).toBe('Большое путешествие на велосипеде через всю Среднюю Азию');
  });
  it('одно сверхдлинное слово уменьшается, а не вылезает за край', () => {
    const r = layoutTitle('Достопримечательностеведение', measure, 400, 2, 100, 20);
    expect(measure(r.lines[0], r.size)).toBeLessThanOrEqual(400 + 0.5);
  });
});

describe('layoutTitle: порог, дефисы и честный флаг fits', () => {
  const measure = (s: string, size: number) => s.length * size * 0.6;

  it('помещается при кегле не ниже порога — fits: true; не помещается — fits: false, но текст виден целиком', () => {
    const ok = layoutTitle('Ёлки и ущелья', measure, 900, 3, 112, 96);
    expect(ok).toMatchObject({ fits: true, lines: ['Ёлки и ущелья'] });
    const long = 'Очень длинное название путешествия через горы и пустыни Средней Азии и дальше на восток';
    const bad = layoutTitle(long, measure, 800, 3, 112, 96);
    expect(bad.fits).toBe(false);
    expect(bad.size).toBeLessThan(96);
    for (const line of bad.lines) expect(measure(line, bad.size)).toBeLessThanOrEqual(800 + 0.5);
    expect(bad.lines.join(' ').replace(/ /g, ' ')).toBe(long);
  });

  it('высота ограничивает число строк: 3 строки по 96 в 280 не помещаются при интервале 1,1, а при 0,96 — помещаются', () => {
    const text = 'Альфа Браво Чарли';
    const roomy = layoutTitle(text, measure, 500, 3, 96, 96, 280, 1.1);
    expect(roomy.fits).toBe(false);
    const tight = layoutTitle(text, measure, 500, 3, 96, 96, 280, 0.96);
    expect(tight.fits).toBe(true);
    expect(tight.lines).toHaveLength(3);
  });

  it('составное название с дефисом переносится по дефису, если иначе слово не влезает', () => {
    const r = layoutTitle('Санкт-Петербург', measure, 700, 3, 112, 96);
    expect(r.fits).toBe(true);
    expect(r.lines).toEqual(['Санкт-', 'Петербург']);
  });
});

describe('titleFits: строки истории 67 в кадре (≤ 3 строк в 9:16, ≤ 2 в 16:9, кегль не ниже порога роли)', () => {
  const FIT = ['Ёлки и ущелья', 'Кыргызстан', 'Турция → Китай', 'Санкт-Петербург — Владивосток', 'Mongolia'];

  it.each([['9:16'], ['16:9']] as const)('%s: короткие и составные названия помещаются у всех стилей', (format) => {
    for (const styleId of ['epic', 'atlas', 'neon'] as const) {
      for (const title of FIT) expect(titleFits('ru', title, format, styleId), `${format} ${styleId} «${title}»`).toEqual({ fits: true, maxChars: title.length });
    }
  });

  it('80 символов и слово без пробелов в 40 знаков не помещаются; maxChars — длина наибольшего начала, которое помещается', () => {
    const eighty = 'Очень длинное название путешествия через горы, пустыни и степи Средней Азии..';
    expect(eighty.length).toBeGreaterThan(70);
    for (const text of [eighty + '...', 'Достопримечательностеведениеведениеведение']) {
      for (const format of ['9:16', '16:9'] as const) {
        const r = titleFits('ru', text, format, 'epic');
        expect(r.fits, `${format} «${text.slice(0, 20)}»`).toBe(false);
        expect(r.maxChars).toBeLessThan(text.length);
        expect(titleFits('ru', text.slice(0, r.maxChars).trimEnd(), format, 'epic').fits).toBe(true);
      }
    }
  });

  it('число строк не больше предела формата: 3 в 9:16, 2 в 16:9', () => {
    const t = 'Из Стамбула в Самарканд по Шёлковому пути';
    expect(fitTitle(t, '9:16', 'epic')).toMatchObject({ fits: true });
    expect(fitTitle(t, '9:16', 'epic').lines.length).toBeLessThanOrEqual(3);
    const wide = fitTitle(t, '16:9', 'epic');
    expect(wide.lines.length).toBeLessThanOrEqual(2);
    // 16:9 строже: тот же текст в одном стиле помещается, в другом (крупнее и шире) — нет
    expect(titleFits('ru', t, '16:9', 'atlas').fits).toBe(true);
  });

  it('кегль заголовка в пределах роли стиля, пока заголовок помещается', () => {
    for (const [id, min, max] of [['epic', 96, 112], ['atlas', 100, 120], ['neon', 88, 104]] as const) {
      const r = fitTitle('Из Стамбула в Самарканд', '9:16', id);
      expect(r.fits).toBe(true);
      expect(r.size).toBeGreaterThanOrEqual(min);
      expect(r.size).toBeLessThanOrEqual(max);
    }
  });
});

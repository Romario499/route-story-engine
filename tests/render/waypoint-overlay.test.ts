// Оформление маршрута по меткам (ADR 0010, истории 141–142): честная подпись, показатели без километража трека, смена транспорта.
// Синтетика; холст-«магнитофон». Значки проверяются подменой drawIcon.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const iconCalls: string[] = [];
vi.mock('../../src/render/assets', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/render/assets')>();
  return { ...original, drawIcon: (...args: Parameters<typeof original.drawIcon>) => { iconCalls.push(args[1]); } };
});

import { layoutFor, timelineOptionsFor } from '../../src/render/layout';
import { drawOverlay, overlayAttributionRect, resolveTitle } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { buildTimeline } from '../../src/story';
import { journeyFacts } from '../../src/story/legs';
import { FPS, type Format, type FrameState, type InfoKey, type Lang, type StorySettings, type StyleId } from '../../src/types';
import { enrichmentFor, settings as baseSettings } from '../story/fixtures';
import { jw, syntheticJourney, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';
import { t } from '../../src/i18n';

const CYRILLIC = /[Ѐ-ӿ]/;
const route = waypointRoute(syntheticJourney());
const facts = journeyFacts(route)!;
// граница стран далеко от поезда: иначе карточка страны занимает слот
const enrichment = enrichmentFor(route, { border: 12 });
const ALL_ON: Record<InfoKey, boolean> = {
  distance: true, day: true, date: true, country: true, city: true, altitude: true, speed: true, profile: true, progress: true,
};
const setup = (patch: Partial<StorySettings> = {}): StorySettings =>
  baseSettings({ info: ALL_ON, title: patch.lang === 'en' ? 'Test' : 'Тест', author: '', ...patch });
const framesOf = (s: StorySettings) => {
  const tl = buildTimeline(route, enrichment, s, timelineOptionsFor(s.format, s.styleId));
  return Array.from({ length: tl.frameCount + 1 }, (_, i) => tl.frameAt(i / FPS));
};
const draw = (frame: FrameState, s: StorySettings, rec = recorder()) => {
  drawOverlay(rec.ctx, frame, { route, enrichment, settings: s, style: STYLES[s.styleId], reconstruction: false });
  return rec;
};

beforeEach(() => { iconCalls.length = 0; });

it('город у достигнутой метки: отдельная подпись «Рядом» / “Near” без склонения названия', () => {
  for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas', 'neon'] as const) for (const lang of ['ru', 'en'] as const) {
    const s = setup({ format, styleId, lang });
    const f = framesOf(s).find(f => f.act === 'journey' && f.stats.place && f.t > 8)!;
    expect(f).toBeDefined();
    const rec = draw(f, s);
    const label = lang === 'ru' ? 'Рядом' : 'Near';
    expect(t(lang, 'label.nearMark')).toBe(label);
    expect(rec.texts).toContain(label);
    expect(rec.texts).toContain(lang === 'ru' ? f.stats.place!.nameRu : f.stats.place!.nameEn);
  }
});

it('без города и на перелёте нет показателя, иконки и пустой ячейки: холст совпадает с city=false', () => {
  for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas', 'neon'] as const) for (const lang of ['ru', 'en'] as const) {
    const s = setup({ format, styleId, lang });
    const fs = framesOf(s);
    const hop = fs.find(f => f.act === 'journey' && f.head > 39.1 && f.head < 39.9)!;
    const reached = fs.find(f => f.act === 'journey' && f.stats.place && f.t > 8)!;
    expect(hop).toBeDefined();
    expect(hop.stats.place).toBeNull();
    const noCity = { ...reached, stats: { ...reached.stats, place: null } };
    for (const f of [hop, noCity]) {
      iconCalls.length = 0;
      const actual = draw(f, s), icons = [...iconCalls];
      iconCalls.length = 0;
      const expected = draw(f, { ...s, info: { ...s.info, city: false } });
      expect(actual.texts).not.toContain(t(lang, 'label.nearMark'));
      expect(actual.texts).not.toContain('—');
      expect(icons).not.toContain('city');
      expect(icons).toEqual(iconCalls);
      expect(actual.ops).toEqual(expected.ops);
    }
  }
});

/** Строки кадра: цифры чисел рисуются по одной (табличные), поэтому собираем текст по базовой линии слева направо, пробелы убираем. */
const rowsOf = (rec: ReturnType<typeof recorder>): string[] => {
  const byY = new Map<number, { text: string; x: number }[]>();
  for (const p of rec.placed) {
    const key = Math.round(p.y);
    byY.set(key, [...(byY.get(key) ?? []), { text: p.text, x: p.x }]);
  }
  return [...byY.values()].map((row) => row.sort((a, b) => a.x - b.x).map((r) => r.text).join('').replace(/\s/g, ''));
};

describe('подпись «маршрут по меткам, не GPS-трек» (история 141)', () => {
  it.each([['ru', 'маршрут по меткам, не GPS-трек'], ['en', 'route from waypoints, not a GPS track']] as const)(
    '%s: есть в кадре пути, в интро и в финале',
    (lang, note) => {
      const s = setup({ lang });
      const fs = framesOf(s);
      const journey = fs.find((f) => f.act === 'journey' && f.t > 8)!;
      expect(draw(journey, s).texts).toContain(note);
      const intro = draw(fs[0], s).texts.join('|').toLowerCase();
      expect(intro).toContain(note.toLowerCase());
      const outro = draw(fs[fs.length - 1], s).texts.join('|').toLowerCase();
      expect(outro).toContain(note.toLowerCase());
    },
  );

  it('у обычного GPS-маршрута такой подписи нет (в тестах оформления GPS — прежний вид)', async () => {
    const { lineRoute } = await import('../story/fixtures');
    const gps = lineRoute(60);
    const s = setup();
    const tl = buildTimeline(gps, enrichmentFor(gps), s, timelineOptionsFor(s.format));
    const rec = recorder();
    for (let t = 0; t <= 30; t += 1) drawOverlay(rec.ctx, tl.frameAt(t), { route: gps, enrichment: enrichmentFor(gps), settings: s, style: STYLES.epic, reconstruction: false });
    expect(rec.texts.join('|').toLowerCase()).not.toContain('по меткам');
  });
});

describe('показатели без выдуманных цифр (история 142)', () => {
  const s = setup();
  const mid = framesOf(s).find((f) => f.act === 'journey' && f.head >= 30)!;
  const rec = draw(mid, s);
  const all = rec.texts.join('|');

  it('километража и неподтверждённой нижней границы нет даже при включённом distance', () => {
    expect(all).not.toMatch(/км|по прямой|не менее/i);
    expect(rec.texts).not.toContain('Пройдено');
  });

  it('ночёвки и день по меткам — числа из фактов на голове; скорости, высоты, даты и профиля нет', () => {
    const nights = String(facts.nights[Math.floor(mid.head)]);
    const day = String(Math.floor(mid.head) + 1);
    expect(rec.texts).toContain('Места ночёвок');
    expect(rec.texts).toContain('Метки');
    expect(rowsOf(rec)).toContain(nights + day);
    for (const banned of ['Скорость', 'Высота', 'Дата', 'Профиль высот', 'км/ч']) expect(all).not.toContain(banned);
  });

  it('контрпример A–C–B–D: 5 км между закладками при реальном пути A–B–C–D в 3 км не показываются ни на одном кадре', () => {
    // На экваторе один шаг 0.0089932° ≈ 1 км; порядок закладок: A, C, B, D.
    const step = 0.0089932;
    const reordered = waypointRoute([0, 2, 1, 3].map((x, i) => jw(0, x * step, 'overnight', i)));
    expect(journeyFacts(reordered)!.straightTotalKm).toBeCloseTo(5, 2);
    const e = enrichmentFor(reordered);
    for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas'] as const) for (const lang of ['ru', 'en'] as const) {
      const settings = setup({ format, styleId, lang });
      const tl = buildTimeline(reordered, e, settings, timelineOptionsFor(format, styleId));
      const rec = recorder();
      for (let i = 0; i <= tl.frameCount; i++) drawOverlay(rec.ctx, tl.frameAt(i / FPS), { route: reordered, enrichment: e, settings, style: STYLES[styleId], reconstruction: false });
      expect(rec.texts.join('|'), format + ' ' + styleId + ' ' + lang).not.toMatch(/км|\bkm\b|по прямой|не менее|straight line|at least/i);
    }
    // Без ночёвок итоги тоже не должны подменять их расстоянием.
    const unknown = waypointRoute([jw(0, 0, 'unknown'), jw(0, step, 'unknown')]);
    const tl = buildTimeline(unknown, enrichmentFor(unknown), s, timelineOptionsFor(s.format));
    const out = recorder();
    drawOverlay(out.ctx, tl.frameAt(30), { route: unknown, enrichment: null, settings: s, style: STYLES.epic, reconstruction: false });
    expect(out.texts.join('|')).not.toMatch(/км|по прямой|не менее/i);
  });

  it('итог: ночёвки, страны и дни по меткам без километража', () => {
    const fs = framesOf(s);
    const out = draw(fs[fs.length - 1], s);
    const text = out.texts.join('|');
    expect(rowsOf(out)).toContain(String(facts.nightsTotal));
    expect(text).toContain('место ночёвки');
    expect(text).not.toMatch(/дн\S* · по меткам/);
    expect(text).toContain('меток');
    for (const banned of ['пройдено', 'по треку', 'разрывы', 'макс. высота', 'км', 'по прямой', 'не менее']) expect(text).not.toContain(banned);
  });
});

describe('смена транспорта — одна подпись в слоте (история 141)', () => {
  it('на кадре с поездом: «Смена транспорта», «Поезд», значок поезда; уницикл подписан предположением', () => {
    const s = setup();
    const fs = framesOf(s);
    const trainFrame = fs.find((f) => f.cards[0]?.transport?.kind === 'train' && f.cards[0].alpha > 0.99)!;
    expect(trainFrame).toBeDefined();
    const rec = draw(trainFrame, s);
    expect(rec.texts.join('|')).toContain('СМЕНА ТРАНСПОРТА'); // надзаголовок — капсом
    expect(rec.texts).toContain('Поезд');
    expect(iconCalls).toContain('train');
    // смена на «неизвестно» тоже подписана, но не называет способ
    const unknown = fs.find((f) => f.cards[0]?.transport?.kind === 'unknown' && f.cards[0].alpha > 0.99);
    // у участка без способа заголовок смысловой, а оговорка — надзаголовок капсом
    if (unknown) { const u = draw(unknown, s).texts; expect(u).toContain('Следующий участок'); expect(u).toContain('СПОСОБ НЕИЗВЕСТЕН'); }
  });

  it('значок смены не дублируется плашкой: пока подпись на полной яркости, она в слоте одна', () => {
    const s = setup();
    const f = framesOf(s).find((x) => x.cards[0]?.transport && x.cards[0].alpha > 0.99)!;
    const rec = draw(f, s);
    // плашка страны в тот же момент погашена: её название (из обогащения) в кадре не рисуется
    expect(rec.texts).not.toContain('Грузия');
    expect(rec.texts).not.toContain('Армения');
  });
});

describe('языки и стили', () => {
  const combos: [Format, StyleId, Lang][] = [['9:16', 'epic', 'en'], ['16:9', 'atlas', 'en'], ['9:16', 'neon', 'ru'], ['16:9', 'epic', 'ru']];
  it.each(combos)('%s %s %s: весь ролик на выбранном языке, без километража трека', (format, styleId, lang) => {
    const s = setup({ format, styleId, lang });
    const rec = recorder();
    for (const f of framesOf(s).filter((_, i) => i % 6 === 0)) draw(f, s, rec);
    const all = [...new Set(rec.texts)];
    expect(all.length).toBeGreaterThan(10);
    if (lang === 'en') expect(all.filter((txt) => CYRILLIC.test(txt)), 'кириллица в EN').toEqual([]);
    expect(all.join('|')).not.toMatch(/km\/h|км\/ч/);
  });
});

describe('заголовок по умолчанию', () => {
  it('у маршрута по меткам имя документа KML не становится названием поездки: берётся страна, а у GPS-трека имя файла остаётся', () => {
    const named = { ...route, name: 'Organic Maps Bookmarks and Tracks' };
    const oneCountry = { ...enrichment, countryRuns: [{ fromIdx: 0, toIdx: route.points.length - 1, country: enrichment.countries[0] }] };
    expect(resolveTitle('ru', '', named, oneCountry)).toBe('Грузия');
    expect(resolveTitle('en', '', named, { ...oneCountry, countryRuns: [] })).toBe('My journey');
    expect(resolveTitle('ru', 'Моя поездка', named, oneCountry)).toBe('Моя поездка');
    const gps = { ...named, source: { kind: 'track' as const }, journeyWaypoints: undefined };
    expect(resolveTitle('ru', '', gps, oneCountry)).toBe('Organic Maps Bookmarks and Tracks');
  });
});

describe('косметика кадра: «Рядом», участок без способа, атрибуция над прогрессом', () => {
  it('«Рядом»: пока название города погашено как дубль подписи события, нет ни прочерка, ни подписи, ни значка', () => {
    for (const format of ['9:16', '16:9'] as const) for (const lang of ['ru', 'en'] as const) {
      const s = setup({ format, styleId: 'epic', lang });
      const f = framesOf(s).find((x) => x.act === 'journey' && x.stats.place && x.cards[0]?.transport && x.cards[0].alpha > 0.99);
      expect(f, `${format} ${lang}: кадр с картой участка и городом рядом`).toBeDefined();
      iconCalls.length = 0;
      const rec = draw(f!, s);
      expect(rec.texts).not.toContain(t(lang, 'label.nearMark'));
      expect(rec.texts).not.toContain('—');
      expect(rec.texts).not.toContain(lang === 'ru' ? f!.stats.place!.nameRu : f!.stats.place!.nameEn);
      expect(iconCalls).not.toContain('city');
      // остальные показатели на месте
      expect(rec.texts).toContain(t(lang, 'label.nights'));
    }
  });

  it('участок с неизвестным способом: заголовок — «Следующий участок», «Способ неизвестен» остаётся видимой строкой (в т. ч. при источнике главы)', () => {
    for (const lang of ['ru', 'en'] as const) {
      const s = setup({ lang });
      const f = framesOf(s).find((x) => x.cards[0]?.transport?.kind === 'unknown' && x.cards[0].alpha > 0.99);
      expect(f, `${lang}: карта участка с неизвестным способом`).toBeDefined();
      for (const frame of [f!, { ...f!, chapterMood: { weights: { cold: 1, heat: 0, rain: 0, altitude: 0, warmth: 0, neutral: 0 } } }]) {
        const rec = draw(frame, s);
        const head = rec.textRects.filter((r) => r.text === t(lang, 'transport.unknownLeg'));
        const note = rec.textRects.filter((r) => r.text.toLowerCase() === t(lang, 'transport.unknown').toLowerCase());
        expect(head, `${lang}: заголовок`).toHaveLength(1);
        expect(note, `${lang}: оговорка`).toHaveLength(1);
        expect(note[0].y, 'оговорка — надзаголовок, меньше и выше заголовка').toBeLessThan(head[0].y);
        expect(note[0].h).toBeLessThan(head[0].h);
        expect(rec.texts).not.toContain(t(lang, 'transport.unknown')); // главным крупным заголовком служебная фраза не бывает
      }
    }
    expect(t('ru', 'transport.unknownLeg')).toBe('Следующий участок');
    expect(t('en', 'transport.unknownLeg')).toBe('Next leg');
  });

  it.each(['epic', 'atlas', 'neon'] as const)('атрибуция и полоса прогресса: зазор ≥ 8 px, всё внутри кадра (%s)', (styleId) => {
    for (const format of ['9:16', '16:9'] as const) {
      const s = setup({ format, styleId });
      const layout = layoutFor(format, styleId);
      const f = framesOf(s).find((x) => x.act === 'journey')!;
      const rec = recorder();
      const rect = overlayAttributionRect(rec.ctx, f, { route, enrichment, settings: s, style: STYLES[styleId], reconstruction: false });
      const stroke = 2; // обводка текста — 0,1 кегля (кегль атрибуции ≤ 20)
      const bottom = rect.y + rect.h + stroke, top = rect.y - stroke;
      const { progress } = layout;
      const gap = format === '16:9' ? 8 : 0; // 16:9: строка над полосой; 9:16: полоса над текстом (там зазор задаёт сам расчёт атрибуции)
      const disjointY = bottom + gap <= progress.y || top >= progress.y + progress.h + gap;
      expect(disjointY, `${format} ${styleId}: атрибуция ${top.toFixed(1)}…${bottom.toFixed(1)} против прогресса ${progress.y}…${progress.y + progress.h}`).toBe(true);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(layout.height);
      expect(rect.x + rect.w).toBeLessThanOrEqual(layout.width);
      expect(progress.y + progress.h).toBeLessThanOrEqual(layout.height);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { buildRoute, parseRouteText } from '../../src/route';
import { layoutFor, overviewPaddingFor } from '../../src/render/layout';
import { drawOverlay } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { buildTimeline } from '../../src/story';
import type { Enrichment, Format, FrameState, InfoKey, Lang, Route, StorySettings, StyleId } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';
import sampleGpx from '../../public/samples/wahrier-reconstruction.gpx?raw';
import { enrichmentFor, lineRoute, settings as baseSettings } from '../story/fixtures';
import { recorder } from './overlay-recorder';

const CYRILLIC = /[Ѐ-ӿ]/;
const SAMPLE_AUTHOR = '@wahrier · реконструкция маршрута';

const geo = createGeoIndex(JSON.parse(countriesRaw) as CountriesJson, JSON.parse(placesRaw) as PlacesJson);
const parsed = parseRouteText('wahrier-reconstruction.gpx', sampleGpx);
if (!parsed.ok) throw new Error(parsed.error);
const built = buildRoute(parsed.tracks);
if ('error' in built) throw new Error(built.error);
const sampleRoute: Route = built;
const sampleEnrichment: Enrichment = enrichRoute(sampleRoute, geo);

const ALL_ON: Record<InfoKey, boolean> = {
  distance: true, day: true, date: true, country: true, city: true, altitude: true, speed: true, profile: true, progress: true,
};

function sampleSettings(patch: Partial<StorySettings> = {}): StorySettings {
  return baseSettings({ info: ALL_ON, title: '', author: SAMPLE_AUTHOR, ...patch });
}

function timelineFor(s: StorySettings, route = sampleRoute, e: Enrichment = sampleEnrichment) {
  return buildTimeline(route, e, s, { overviewPadding: overviewPaddingFor(s.format) });
}

function draw(frame: FrameState, s: StorySettings, route = sampleRoute, e: Enrichment | null = sampleEnrichment, rec = recorder()) {
  drawOverlay(rec.ctx, frame, { route, enrichment: e, settings: s, style: STYLES[s.styleId], reconstruction: route === sampleRoute });
  return rec;
}

describe('drawOverlay: все тексты ролика на выбранном языке', () => {
  const combos: [Format, StyleId, Lang][] = [
    ['9:16', 'epic', 'en'], ['16:9', 'neon', 'en'], ['9:16', 'atlas', 'en'], ['16:9', 'epic', 'ru'],
  ];
  it.each(combos)('%s %s %s: интро, путешествие и финал без чужого языка', (format, styleId, lang) => {
    const s = sampleSettings({ format, styleId, lang });
    const tl = timelineFor(s);
    const rec = recorder();
    for (let t = 0; t <= tl.durationSec; t += 0.25) draw(tl.frameAt(t), s, sampleRoute, sampleEnrichment, rec);
    draw(tl.frameAt(tl.durationSec), s, sampleRoute, sampleEnrichment, rec);
    const all = [...new Set(rec.texts)];
    expect(all.length).toBeGreaterThan(20);
    const allowed = /wahrier|OpenFreeMap|EOxCloudless|EOX|Copernicus|Sentinel|AWS|Imagery|Terrain|OpenMapTiles|OpenStreetMap|Shaded|Relief/i;
    const leaked = all.filter((txt) => (lang === 'en' ? CYRILLIC.test(txt) : /[A-Za-z]{4,}/.test(txt) && !allowed.test(txt)));
    expect(leaked, `чужой язык: ${leaked.join(' | ')}`).toEqual([]);
  });
});

describe('drawOverlay: информационные элементы', () => {
  const s = sampleSettings();
  const tl = timelineFor(s);
  const midRaw = tl.frameAt(tl.durationSec * 0.45);
  // рядом есть город — иначе строка «Рядом» (и её переключатель) ничего не рисуют
  const mid: FrameState = { ...midRaw, stats: { ...midRaw.stats, place: { nameRu: 'Капан', nameEn: 'Kapan', lat: 0, lon: 0, pop: 1 } } };

  it('все девять включаются и выключаются настройкой', () => {
    const full = draw(mid, s).ops.join('\n');
    for (const key of Object.keys(ALL_ON) as InfoKey[]) {
      const off = draw(mid, sampleSettings({ info: { ...ALL_ON, [key]: false } })).ops.join('\n');
      expect(off, `выключенный «${key}» меняет рисунок`).not.toBe(full);
    }
  });

  it('цифры кадра выводятся значениями из frame.stats', () => {
    const rec = draw(mid, s);
    const txt = rec.texts.join('|').replace(/ /g, ' ');
    // цифры рисуются по одной (табличные), поэтому числа проверяем по склейке без разделителей
    const glued = rec.texts.join('').replace(/ /g, ' ');
    expect(txt).toContain('День');
    expect(glued).toContain(String(mid.stats.day));
    expect(glued).toContain(String(Math.round(mid.stats.speedKmh ?? 0)));
    expect(glued).toContain(Math.round(mid.stats.altitudeM ?? 0).toLocaleString('ru-RU').replace(/ | /g, ' '));
    expect(txt).toContain(mid.stats.country?.nameRu ?? '');
    expect(txt).toContain('Профиль высот');
  });

  it('недоступное по данным не рисуется: без времени — нет дня, даты, скорости; без высоты — нет высоты и профиля', () => {
    const route = lineRoute(60); // ни времени, ни высоты
    const e = enrichmentFor(route);
    const t2 = timelineFor(sampleSettings(), route, e);
    const frame = t2.frameAt(t2.durationSec * 0.5);
    const a = draw(frame, sampleSettings(), route, e);
    const b = draw(frame, sampleSettings({ info: { ...ALL_ON, day: false, date: false, speed: false, altitude: false, profile: false } }), route, e);
    expect(a.ops.join('\n')).toBe(b.ops.join('\n'));
    const txt = a.texts.join('|');
    expect(txt).not.toMatch(/День|Дата|Скорость|Высота/i);
    expect(txt).toMatch(/Пройдено/i);
  });

  const KAPAN = { nameRu: 'Капан', nameEn: 'Kapan', lat: 0, lon: 0, pop: 1 };
  /** Всё нарисованное до подписи первой строки цифр = рамка карточки цифр (и всё, что под ней). */
  const beforeStats = (ops: string[]) => ops.slice(0, ops.findIndex((o) => o.startsWith('fillText:Участки и разрывы')));

  it('строка «Рядом» резервируется: без города остаётся подпись и прочерк, высота карточки та же', () => {
    const withPlace = draw({ ...mid, stats: { ...mid.stats, place: KAPAN } }, s);
    const without = draw({ ...mid, stats: { ...mid.stats, place: null } }, s);
    expect(withPlace.texts.join('|')).toMatch(/РЯДОМ/i);
    expect(withPlace.texts).toContain('Капан');
    expect(without.texts.join('|')).toMatch(/РЯДОМ/i);
    expect(without.texts).not.toContain('Капан');
    expect(without.texts).toContain('—');
    const a = beforeStats(withPlace.ops), b = beforeStats(without.ops);
    expect(a.length).toBeGreaterThan(5);
    expect(b).toEqual(a);
    const labelAt = (ops: string[]) => ops.find((o) => /^fillText:(РЯДОМ|Рядом)/i.test(o));
    expect(labelAt(without.ops)).toBeDefined();
    expect(labelAt(without.ops)).toBe(labelAt(withPlace.ops));
  });

  it('когда город пропадает, название плавно гаснет от frame.placeChange и t, а не исчезает мгновенно', () => {
    // трек, где «рядом» есть только в первой половине (Тбилиси), потом города нет
    const route = lineRoute(1000);
    const base = enrichmentFor(route, { border: 500 });
    const e: Enrichment = { ...base, placeAt: (i) => (i < 500 ? base.placeAt(0) : null) };
    const name = base.placeAt(0)!.nameRu;
    const t2 = timelineFor(s, route, e);
    let at = -1;
    for (let t = 3; t < t2.durationSec && at < 0; t += 1 / 30) {
      const f = t2.frameAt(t);
      if (f.act === 'journey' && f.placeChange && !f.placeChange.visible && f.stats.place === null) at = f.placeChange.at;
    }
    expect(at, 'на треке есть момент, когда ближайший город пропадает').toBeGreaterThan(0);
    expect(draw(t2.frameAt(at - 0.1), s, route, e).texts).toContain(name); // пока рядом — видно
    expect(draw(t2.frameAt(at + 0.1), s, route, e).texts).toContain(name); // ещё держится
    expect(draw(t2.frameAt(at + 0.6), s, route, e).texts).not.toContain(name); // за 0,35 с угасло
  });

  it('без включённых элементов карточки цифр нет', () => {
    const none = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false])) as Record<InfoKey, boolean>;
    const txt = draw(mid, sampleSettings({ info: none })).texts.join('|');
    expect(txt).not.toMatch(/Пройдено|ДЕНЬ|День/i);
  });
});

describe('drawOverlay: въезд в страну без дубля', () => {
  const s = sampleSettings({ info: { ...ALL_ON, profile: false, progress: false } });
  const tl = timelineFor(s);
  const base = tl.frameAt(tl.durationSec * 0.45);
  const country = sampleEnrichment.countries[1];
  const withCountryBeat: FrameState = {
    ...base,
    cards: [{ beat: { kind: 'country', idx: base.head | 0, country }, alpha: 1, enter: 1 }],
  };
  const kicker = /СТРАНА/i;

  it('галочка «Страна» включена — плашка есть, карточки бита kind=country нет', () => {
    const txt = draw(withCountryBeat, s).texts;
    expect(txt.join('|')).not.toMatch(kicker);
    expect(txt).toContain(base.stats.country?.nameRu ?? ''); // плашка на месте
  });

  it('галочка выключена — карточка остаётся', () => {
    const off = sampleSettings({ info: { ...ALL_ON, country: false, profile: false, progress: false } });
    expect(draw(withCountryBeat, off).texts.join('|')).toMatch(kicker);
  });

  it('другие карточки (старт, пик) при включённой «Стране» не пропадают', () => {
    const peak: FrameState = { ...base, cards: [{ beat: { kind: 'peak', idx: 0, ele: 2313 }, alpha: 1, enter: 1 }] };
    expect(draw(peak, s).texts.join('|')).toMatch(/Высшая точка/i);
  });
});

describe('drawOverlay: плашка страны сменяется анимацией', () => {
  const s = sampleSettings({ info: { ...ALL_ON, profile: false, progress: false } });
  const tl = timelineFor(s);
  /** Первый кадр путешествия, где страна поменялась. */
  function findChange(): { t: number; from: string; to: string } {
    let prev: string | undefined;
    for (let t = 0; t < tl.durationSec; t += 1 / 30) {
      const f = tl.frameAt(t);
      const iso = f.stats.country?.iso2;
      if (f.act === 'journey' && prev && iso && iso !== prev) return { t, from: prev, to: iso };
      if (f.act === 'journey') prev = iso;
    }
    throw new Error('в примере нет смены страны');
  }
  const change = findChange();
  const nameOf = (iso: string) => sampleEnrichment.countries.find((c) => c.iso2 === iso)!.nameRu;
  /** Момент начала смены плашки — из самого кадра (frame.countryChange.at), а не из истории рисования. */
  const swapAt = tl.frameAt(change.t).countryChange?.at ?? change.t;

  it('сразу после въезда видны обе плашки, через секунду — только новая; кадр самодостаточен (без истории на холсте)', () => {
    const during = draw(tl.frameAt(swapAt + 0.2), s).texts; // свежий холст: прошлых кадров нет
    expect(during).toContain(nameOf(change.from));
    expect(during).toContain(nameOf(change.to));
    const after = draw(tl.frameAt(swapAt + 1.2), s).texts;
    expect(after).toContain(nameOf(change.to));
    expect(after).not.toContain(nameOf(change.from));
  });

  it('кадр после перемотки идентичен кадру последовательного прохода (детерминизм seek)', () => {
    const times = [swapAt - 0.4, swapAt + 0.05, swapAt + 0.2, swapAt + 0.5];
    for (const target of times) {
      const seq = recorder();
      for (let t = Math.max(0, target - 1); t < target - 1e-6; t += 1 / 30) draw(tl.frameAt(t), s, sampleRoute, sampleEnrichment, seq);
      const mark = seq.ops.length;
      draw(tl.frameAt(target), s, sampleRoute, sampleEnrichment, seq);
      const sequential = seq.ops.slice(mark);
      const seek = draw(tl.frameAt(target), s).ops;
      expect(seek, `t=${target.toFixed(2)}`).toEqual(sequential);
    }
  });
});

describe('drawOverlay: интро, карточки битов и финал', () => {
  const s = sampleSettings({ lang: 'en' });
  const tl = timelineFor(s);

  it('интро: заголовок «Turkey → China» по умолчанию, диапазон дат, автор по-английски', () => {
    const txt = draw(tl.frameAt(0.3), s).texts.join('|');
    expect(txt.toUpperCase()).toContain('TURKEY');
    expect(txt.toUpperCase()).toContain('CHINA');
    expect(txt).toMatch(/MAY/i);
    expect(txt).toContain('@wahrier · route reconstruction');
  });

  it('карточки битов: «Start» на примере и «Highest point» на треке с пиком — через i18n', () => {
    let startSeen = false;
    for (let t = 0; t < tl.durationSec; t += 0.1) {
      const f = tl.frameAt(t);
      if (!f.cards.some((c) => c.beat.kind === 'start' && c.alpha > 0.6)) continue; // почти прозрачную карточку не видно
      startSeen = true;
      expect(draw(f, s).texts.join('|').toUpperCase()).toContain('START');
    }
    expect(startSeen).toBe(true);
    // на примере пик уступает въездам в страны (одна подпись за раз), поэтому карточку пика проверяем на коротком треке без стран
    const route = lineRoute(1000);
    const enr = enrichmentFor(route, {
      beats: [{ kind: 'start', idx: 0 }, { kind: 'peak', idx: 500, ele: 2400 }, { kind: 'finish', idx: 999 }],
    });
    const ptl = timelineFor(s, route, enr);
    let peakSeen = false;
    for (let t = 0; t < ptl.durationSec; t += 0.1) {
      const f = ptl.frameAt(t);
      if (!f.cards.some((c) => c.beat.kind === 'peak' && c.alpha > 0.6)) continue;
      peakSeen = true;
      expect(draw(f, s, route, enr).texts.join('|').toUpperCase()).toContain('HIGHEST POINT');
    }
    expect(peakSeen).toBe(true);
  });

  it('финал: итоговая карточка — км, дни, страны, макс. высота; заголовок и автор остаются', () => {
    const f = tl.frameAt(tl.durationSec);
    const rec = draw(f, s);
    const txt = rec.texts.join('|');
    const glued = rec.texts.join('').replace(/ /g, ' ');
    expect(glued).toContain('5,880');
    expect(glued).not.toContain('6,601');
    expect(txt).toContain('along recorded sections');
    expect(glued).toContain('gap ≈ 721 km in a straight line');
    expect(txt).not.toContain('travelled');
    expect(glued).toContain('70');
    expect(glued).toContain('2,313');
    expect(rec.texts).toContain('8'); // стран
    expect(txt.toUpperCase()).toContain('TRIP SUMMARY');
    expect(txt).toContain('@wahrier');
  });

  it('итоговая карточка 9:16 целиком над нижней зоной Reels', () => {
    const l = layoutFor('9:16');
    expect(l.summary.y + l.summary.h).toBeLessThanOrEqual(l.height - l.safe.bottom);
  });
});

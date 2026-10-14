// Композиция кадра: типографика по ролям стиля, стабильные числа, одна подпись за раз, интро/путь/финал врозь,
// «Экспедиция» / «Атлас» / «Неон» — разное оформление. Холст-«магнитофон» вместо настоящего: проверяем, что и где рисуется.
import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { buildRoute, parseRouteText } from '../../src/route';
import { layoutFor, timelineOptionsFor, WORK_AREA } from '../../src/render/layout';
import { drawOverlay } from '../../src/render/overlay';
import { drawCinematicGeography } from '../../src/render/cinematic';
import { prepareTrack } from '../../src/render/track';
import { STYLES } from '../../src/render/styles';
import { buildTimeline } from '../../src/story';
import type { Enrichment, Format, FrameState, InfoKey, Lang, Place, Route, StorySettings, StyleId } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';
import sampleGpx from '../../public/samples/wahrier-reconstruction.gpx?raw';
import { settings as baseSettings } from '../story/fixtures';
import { recorder } from './overlay-recorder';

const geo = createGeoIndex(JSON.parse(countriesRaw) as CountriesJson, JSON.parse(placesRaw) as PlacesJson);
const parsed = parseRouteText('wahrier-reconstruction.gpx', sampleGpx);
if (!parsed.ok) throw new Error(parsed.error);
const built = buildRoute(parsed.tracks);
if ('error' in built) throw new Error(built.error);
const route: Route = built;
const enrichment: Enrichment = enrichRoute(route, geo);

const NONE: Record<InfoKey, boolean> = {
  distance: false, day: false, date: false, country: false, city: false, altitude: false, speed: false, profile: false, progress: false,
};
const AUTHOR = '@wahrier · реконструкция маршрута';

const cfg = (patch: Partial<StorySettings> & { on?: InfoKey[] } = {}): StorySettings => {
  const { on, ...rest } = patch;
  const info = { ...NONE, ...Object.fromEntries((on ?? ['distance', 'progress', 'country']).map((k) => [k, true])) } as Record<InfoKey, boolean>;
  return baseSettings({ info, title: '', author: AUTHOR, ...rest });
};

const timelineOf = (s: StorySettings) => buildTimeline(route, enrichment, s, timelineOptionsFor(s.format, s.styleId));
const draw = (frame: FrameState, s: StorySettings, reconstruction = true) => {
  const rec = recorder();
  drawOverlay(rec.ctx, frame, { route, enrichment, settings: s, style: STYLES[s.styleId], reconstruction });
  return rec;
};
const glued = (texts: string[]) => texts.join('').replace(/ /g, ' ');
const px = (font: string) => Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 'NaN');
/** Размеры кегля всех шрифтов с данным весом и гарнитурой. */
const sizesOf = (fonts: Set<string>, weight: number, family: string) =>
  [...fonts].filter((f) => f.startsWith(`${weight} `) && f.includes(`'${family}'`)).map(px);

const FORMATS: Format[] = ['9:16', '16:9'];
const STYLE_IDS: StyleId[] = ['epic', 'atlas', 'neon'];

it('легенда DEM ниже полного двухстрочного заголовка с датами и автором', () => {
  const s = cfg({ format: '9:16' }), frame = timelineOf(s).frameAt(2), rec = recorder();
  drawOverlay(rec.ctx, frame, { route, enrichment, settings:s, style:STYLES.epic, reconstruction:true });
  drawCinematicGeography(rec.ctx, frame, route, enrichment, s, STYLES.epic,
    () => ({ x:250,y:500 }), prepareTrack(route), true, true, 1);
  const author = rec.placed.find(v => v.text.includes('реконструкция маршрута'))!;
  const dem = rec.placed.find(v => v.text.includes('DEM'))!;
  expect(dem.y - 26).toBeGreaterThan(author.y + 12);
});

describe('типографика: размеры из StyleDef.type (история 65)', () => {
  it.each(STYLE_IDS)('%s: числа и подписи показателей — по роли стиля, подписи 30–34', (styleId) => {
    const s = cfg({ styleId, on: ['distance', 'progress', 'country'] });
    const tl = timelineOf(s);
    const { fonts } = draw(tl.frameAt(14), s);
    const type = STYLES[styleId].type;
    expect(sizesOf(fonts, type.number.weight, type.number.family), 'числа').toContain(type.number.size);
    expect(sizesOf(fonts, type.label.weight, type.label.family), 'подписи показателей').toContain(type.label.size);
    expect(type.label.size).toBeGreaterThanOrEqual(30);
    expect(type.label.size).toBeLessThanOrEqual(34);
  });

  it.each(STYLE_IDS)('%s: заголовок интро — кегль в пределах роли title, шрифт и вес из стиля', (styleId) => {
    const s = cfg({ styleId, title: 'Большая поездка' });
    const { fonts } = draw(timelineOf(s).frameAt(1), s);
    const { title } = STYLES[styleId].type;
    const sizes = sizesOf(fonts, title.weight, title.family);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size).toBeGreaterThanOrEqual(title.min);
      expect(size).toBeLessThanOrEqual(title.max);
    }
  });

  it('«Экспедиция» и «Неон» — Manrope, «Атлас» — PT Serif для названия, числа Manrope; «Неон» — моноширинные числа', () => {
    const grab = (id: StyleId) => draw(timelineOf(cfg({ styleId: id })).frameAt(14), cfg({ styleId: id })).fonts;
    expect([...grab('epic')].every((f) => /Manrope/.test(f))).toBe(true);
    expect([...grab('neon')].some((f) => /JetBrains Mono/.test(f))).toBe(true);
    const atlasIntro = draw(timelineOf(cfg({ styleId: 'atlas' })).frameAt(1), cfg({ styleId: 'atlas' })).fonts;
    expect([...atlasIntro].some((f) => /PT Serif/.test(f))).toBe(true);
    expect([...grab('atlas')].some((f) => /Manrope/.test(f))).toBe(true);
  });

  it('caps — только в надзаголовках: подписи показателей, названия и страна пишутся обычным регистром', () => {
    const s = cfg({ on: ['distance', 'progress', 'country', 'day', 'altitude'] });
    const tl = timelineOf(s);
    const texts = draw(tl.frameAt(14), s).texts.filter((x) => /[A-Za-zА-Яа-яЁё]{3,}/.test(x));
    expect(texts.length).toBeGreaterThan(4);
    for (const txt of texts) expect(txt, `«${txt}» набрано капсом`).not.toBe(txt.toLocaleUpperCase('ru'));
    // а у надзаголовка — капс
    const intro = draw(tl.frameAt(1), s).texts.join('|');
    expect(intro).toMatch(/МАЯ/); // «1 мая – 9 июля 2025» — надзаголовок интро
  });
});

describe('композиция: интро, путь и финал не смешиваются', () => {
  const s = cfg({ on: ['distance', 'progress', 'country', 'city', 'day'] });
  const tl = timelineOf(s);

  it('интро: есть заголовок и автор, нет плашки страны и показателей', () => {
    const txt = draw(tl.frameAt(1.2), s).texts.join('|');
    expect(txt).toContain('Турция');
    expect(txt).toContain(AUTHOR);
    expect(txt).not.toMatch(/Пройдено|Участки и разрывы|Маршрут|Рядом|День/);
  });

  it('в пути нет заголовка интро; в финале — заголовок, итоги и подпись автора, а показателей пути нет', () => {
    const journey = draw(tl.frameAt(14), s).texts.join('|');
    expect(journey).not.toContain(AUTHOR);
    expect(journey).toMatch(/Участки и разрывы/);
    expect(journey).not.toMatch(/Пройдено/);
    const last = draw(tl.frameAt(tl.durationSec), s);
    const txt = last.texts.join('|');
    expect(txt).toContain('Турция');
    expect(txt).toContain(AUTHOR); // метка реконструкции — и в финале
    expect(txt).toMatch(/География записи/i); // T25: последний GPS-point не доказывает конец поездки.
    expect(txt).not.toMatch(/Маршрут\||\|Рядом/);
    expect(glued(last.texts)).toContain('5 880');
    expect(glued(last.texts)).not.toContain('6 601');
  });

  it('итог: «по треку · разрывы» вместо «своим ходом»', () => {
    const txt = draw(tl.frameAt(tl.durationSec), s).texts.join('|').replace(/ /g, ' ');
    expect(txt).toMatch(/по треку 5 880 км/);
    expect(txt).toMatch(/разрыв ≈ 721 км по прямой/);
    expect(txt).toContain('по записанным участкам');
    expect(txt).not.toMatch(/своим ходом|переезд|пройдено/i);
  });

  it('разрыв трека подписан нейтрально, а вне разрыва подписи нет', () => {
    let gapFrame: FrameState | null = null;
    let plain: FrameState | null = null;
    for (let t = 3; t < 26; t += 1 / 30) {
      const f = tl.frameAt(t);
      const i = Math.floor(f.head);
      const inGap = route.points[i + 1]?.transferBefore && f.head - i > 0.4 && f.head - i < 0.6;
      if (inGap && !gapFrame) gapFrame = f;
      if (!route.points[i + 1]?.transferBefore && f.act === 'journey' && t > 14 && !plain) plain = f;
    }
    expect(gapFrame, 'в примере есть разрыв записи').not.toBeNull();
    expect(draw(gapFrame!, s).texts).toContain('Разрыв записи · путь неизвестен');
    expect(draw(plain!, s).texts).not.toContain('Разрыв записи · путь неизвестен');
    const en = cfg({ lang: 'en', on: ['distance', 'country'] });
    expect(draw(gapFrame!, en).texts).toContain('Recording gap · path unknown');
  });
});

describe('одна событийная подпись в момент (история 77)', () => {
  const s = cfg({ on: ['distance', 'country', 'city'] });
  const tl = timelineOf(s);
  const KAPAN: Place = { nameRu: 'Капан', nameEn: 'Kapan', lat: 0, lon: 0, pop: 1 };

  it('пока видна карточка старта, страна и «рядом» её не дублируют: название места — ровно один раз', () => {
    const base = tl.frameAt(14);
    const frame: FrameState = {
      ...base,
      stats: { ...base.stats, place: KAPAN },
      placeChange: undefined,
      cards: [{ beat: { kind: 'start', idx: 0, place: KAPAN, country: base.stats.country ?? undefined }, alpha: 1, enter: 1 }],
    };
    const texts = draw(frame, s).texts;
    expect(texts.filter((x) => x === 'Капан')).toHaveLength(1);
    expect(texts).not.toContain(base.stats.country?.nameRu ?? '—'); // плашки страны под событием нет
    expect(texts.join('|')).toMatch(/СТАРТ/);
  });

  it('без события — плашка страны и «рядом» как обычно', () => {
    const base = tl.frameAt(14);
    const frame: FrameState = { ...base, stats: { ...base.stats, place: KAPAN }, placeChange: undefined, cards: [] };
    const texts = draw(frame, s).texts;
    expect(texts).toContain('Капан');
    expect(texts).toContain(base.stats.country?.nameRu ?? '—');
  });

  it('плашка страны и событийная карточка делят один слот и никогда не видны вместе — на каждом кадре 15 и 30 с', () => {
    for (const durationSec of [15, 30] as const) {
      const sd = cfg({ on: ['distance', 'country'], durationSec });
      const tld = timelineOf(sd);
      let withCard = 0;
      for (let t = 0; t <= durationSec; t += 1 / 30) {
        const f = tld.frameAt(t);
        const card = f.cards[0];
        if (!card || card.beat.kind === 'country') continue;
        const texts = draw(f, sd).texts;
        const cap = card.beat.place ? card.beat.place.nameRu : card.beat.label ?? '';
        const countries = [f.countryChange?.from, f.countryChange?.to, f.stats.country].filter(Boolean).map((c) => c!.nameRu);
        const cardShown = texts.includes('Старт') || texts.includes('Финиш') || (cap !== '' && texts.includes(cap)) || texts.some((x) => /^(СТАРТ|ФИНИШ)$/.test(x));
        const plaqueShown = countries.some((n) => texts.includes(n));
        expect(cardShown && plaqueShown, `${durationSec} с, t=${t.toFixed(2)}: плашка и карточка вместе`).toBe(false);
        if (cardShown) withCard++;
      }
      expect(withCard, 'карточки в ролике были').toBeGreaterThan(0);
    }
  });

  it('показатели пути не рисуются, пока голова не пошла по маршруту (progress = 0), и появляются с началом движения', () => {
    const sd = cfg({ on: ['distance', 'progress', 'country'] });
    const base = timelineOf(sd).frameAt(14);
    const still: FrameState = { ...base, stats: { ...base.stats, progress: 0, distanceKm: 0 } };
    expect(draw(still, sd).texts).not.toContain('Участки и разрывы');
    expect(draw(base, sd).texts).toContain('Участки и разрывы');
  });

  it('на всём ролике: пока карточка видна полностью, плашка страны не рисуется (стопок нет)', () => {
    let checked = 0;
    for (let t = 3; t < 26; t += 0.1) {
      const f = tl.frameAt(t);
      const card = f.cards[0];
      if (!card || card.alpha < 0.99 || card.beat.kind === 'country') continue;
      const country = f.stats.country?.nameRu;
      const texts = draw(f, s).texts;
      if (country) expect(texts, `t=${t.toFixed(1)}`).not.toContain(country);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('честность данных: реконструкция помечена (история 80)', () => {
  const timed: InfoKey[] = ['distance', 'day', 'date', 'speed', 'country'];

  it('у реконструкции подписи дня, даты, скорости, даты интро и «дней» в итоге — с пометкой «расчётно»', () => {
    const s = cfg({ on: timed });
    const tl = timelineOf(s);
    const journey = draw(tl.frameAt(14), s).texts;
    for (const label of ['День · расчётно', 'Дата · расчётно', 'Скорость · расчётно']) expect(journey, label).toContain(label);
    expect(journey).toContain('Участки и разрывы'); // сумма геометрии, без утверждения о пройденном пути
    expect(draw(tl.frameAt(1.2), s).texts.some((x) => /МАЯ.*РАСЧЁТНО/.test(x))).toBe(true);
    expect(draw(tl.frameAt(tl.durationSec), s).texts).toContain('дней · расчётно');
  });

  it('у настоящей записи (reconstruction: false) пометок нет', () => {
    const s = cfg({ on: timed, author: '@ivan' });
    const tl = timelineOf(s);
    expect(draw(tl.frameAt(14), s, false).texts.join('|')).not.toMatch(/расчётно/);
    expect(draw(tl.frameAt(1.2), s, false).texts.join('|')).not.toMatch(/РАСЧЁТНО/);
    expect(draw(tl.frameAt(tl.durationSec), s, false).texts.join('|')).not.toMatch(/расчётно/);
  });

  it('пометка зависит от флага reconstruction, а не от текста подписи: пустой автор не прячет «расчётно»', () => {
    const s = cfg({ on: timed, author: '' });
    const tl = timelineOf(s);
    const journey = draw(tl.frameAt(14), s, true).texts;
    for (const label of ['День · расчётно', 'Дата · расчётно', 'Скорость · расчётно']) expect(journey, label).toContain(label);
    expect(draw(tl.frameAt(1.2), s, true).texts.some((x) => /МАЯ.*РАСЧЁТНО/.test(x))).toBe(true);
    expect(draw(tl.frameAt(tl.durationSec), s, true).texts).toContain('дней · расчётно');
  });

  it('и наоборот: подпись «реконструкция маршрута» у настоящей записи (reconstruction: false) пометок не рождает', () => {
    const s = cfg({ on: timed, author: AUTHOR });
    const tl = timelineOf(s);
    expect(draw(tl.frameAt(14), s, false).texts.join('|')).not.toMatch(/расчётно/);
    expect(draw(tl.frameAt(tl.durationSec), s, false).texts.join('|')).not.toMatch(/расчётно/);
  });

  it('английский ролик: «estimated»', () => {
    const s = cfg({ lang: 'en', on: timed });
    expect(draw(timelineOf(s).frameAt(14), s).texts).toContain('Speed · estimated');
  });
});

describe('стабильные числа (история 68)', () => {
  const s = cfg({ on: ['distance'], format: '9:16' });
  const tl = timelineOf(s);
  const mid = tl.frameAt(14);
  const withKm = (km: number): FrameState => ({ ...mid, stats: { ...mid.stats, distanceKm: km } });

  const geometry = (ops: string[]) => ops.filter((o) => !o.startsWith('fillText:'));
  const lastDigitAt = (ops: string[]) => [...ops].reverse().find((o) => /^fillText:\d@/.test(o))!;

  it.each([[9, 10], [99, 100], [999, 1000]])('%i → %i км: единицы, правый край цифр и вся геометрия остаются на месте', (a, b) => {
    const ra = draw(withKm(a), s), rb = draw(withKm(b), s);
    const unit = (r: ReturnType<typeof draw>) => r.ops.find((o) => /^fillText:км@/.test(o));
    expect(unit(ra)).toBeDefined();
    expect(unit(rb)).toBe(unit(ra));
    // последняя цифра стоит там же: разряды растут влево
    const [, xa] = lastDigitAt(ra.ops).split('@');
    const [, xb] = lastDigitAt(rb.ops).split('@');
    expect(xb).toBe(xa);
    expect(geometry(rb.ops)).toEqual(geometry(ra.ops));
    // подпись показателя тоже не сдвинулась
    const label = (r: ReturnType<typeof draw>) => r.ops.find((o) => /^fillText:Участки и разрывы@/.test(o));
    expect(label(ra)).toBeDefined();
    expect(label(rb)).toBe(label(ra));
  });

  it('«1 000»: тысячи отделены неразрывным пробелом, единица — отдельным текстом, не отрывается от числа', () => {
    const r = draw(withKm(1000), s);
    expect(r.texts).toContain(' '); // разделитель разрядов — неразрывный
    expect(glued(r.texts)).toContain('1 000');
    expect(r.texts).toContain('км');
  });

  it('появление и исчезновение «рядом» не меняет геометрию блока показателей', () => {
    const s2 = cfg({ on: ['distance', 'city'] });
    const place: Place = { nameRu: 'Капан', nameEn: 'Kapan', lat: 0, lon: 0, pop: 1 };
    const f = tl.frameAt(14);
    const withPlace = draw({ ...f, stats: { ...f.stats, place }, placeChange: undefined }, s2);
    const without = draw({ ...f, stats: { ...f.stats, place: null }, placeChange: undefined }, s2);
    expect(geometry(without.ops)).toEqual(geometry(withPlace.ops));
    const label = (r: ReturnType<typeof draw>) => r.ops.find((o) => /^fillText:Рядом@/.test(o));
    expect(label(without)).toBeDefined();
    expect(label(without)).toBe(label(withPlace));
  });

  it('значения вне диапазона не ломают блок: отрицательная высота и десятичные', () => {
    const s3 = cfg({ on: ['distance', 'altitude'] });
    const f = tl.frameAt(14);
    const neg = draw({ ...f, stats: { ...f.stats, altitudeM: -28, distanceKm: 12.5 } }, s3);
    const text = glued(neg.texts);
    expect(text).toMatch(/[−-]28/);
    expect(text).toContain('12,5');
    expect(neg.texts).toContain('м');
  });
});

describe('композиция по форматам (истории 82–83)', () => {
  it('9:16: заголовок интро — слева от x=64, y≈250; всё оформление внутри рабочей зоны', () => {
    const s = cfg({ format: '9:16', title: 'Ёлки и ущелья' });
    const rec = draw(timelineOf(s).frameAt(1.5), s);
    const first = rec.ops.find((o) => /^fillText:Ёлки/.test(o));
    expect(first).toBeDefined();
    const [x, y] = first!.split('@')[1].split(',').map(Number);
    expect(x).toBeGreaterThanOrEqual(64 - 1);
    expect(x).toBeLessThanOrEqual(64 + 12); // rise-анимация не сдвигает по горизонтали
    expect(y).toBeGreaterThanOrEqual(WORK_AREA['9:16'].y);
    expect(y).toBeLessThanOrEqual(250 + 300);
  });

  it('16:9: заголовок слева сверху x=96, y=72; колонка показателей справа x ≥ 1390', () => {
    const s = cfg({ format: '16:9', title: 'Ёлки и ущелья', on: ['distance', 'progress', 'country'] });
    const tl = timelineOf(s);
    const intro = draw(tl.frameAt(1.5), s).ops.find((o) => /^fillText:Ёлки/.test(o))!;
    expect(Number(intro.split('@')[1].split(',')[0])).toBe(96);
    const stats = draw(tl.frameAt(14), s).ops.filter((o) => /^fillText:(Участки и разрывы|Маршрут)@/.test(o));
    expect(stats).toHaveLength(2);
    // подписи правым краем колонки (≤ 1824), ряды один под другим
    const ys = stats.map((o) => Number(o.split(',')[1]));
    expect(ys[1]).toBeGreaterThan(ys[0]);
    const l = layoutFor('16:9');
    expect(l.stats.x + l.stats.w).toBeLessThanOrEqual(WORK_AREA['16:9'].x + WORK_AREA['16:9'].w);
  });

  it.each(FORMATS)('%s: титр финала (заголовок и подпись автора) заканчивается выше маршрута', (format) => {
    const s = cfg({ format });
    const tl = timelineOf(s);
    const ops = draw(tl.frameAt(tl.durationSec), s).ops;
    const author = ops.find((o) => o.startsWith(`fillText:${AUTHOR}@`))!;
    expect(author, 'подпись автора (метка реконструкции) в финале').toBeDefined();
    const y = Number(author.split(',')[1]);
    expect(y).toBeLessThanOrEqual(layoutFor(format).route.y + 12);
  });

  it.each(FORMATS)('%s: итоги финала не лезут в зоны площадок', (format) => {
    const l = layoutFor(format);
    expect(l.summary.y + l.summary.h).toBeLessThanOrEqual(l.height - l.safe.bottom);
    expect(l.summary.x + l.summary.w).toBeLessThanOrEqual(l.width - l.safe.right);
  });
});

describe('стили: разное оформление («Экспедиция», «Атлас», «Неон»)', () => {
  const frameOf = (id: StyleId, t: number) => {
    const s = cfg({ styleId: id });
    return { s, rec: draw(timelineOf(s).frameAt(t), s) };
  };

  it('«Атлас»: без иконок у показателей, тонкие разделители вместо карточек; «Экспедиция»: иконки есть', () => {
    // иконки рисуются штрихом контура через translate+scale; у «Атласа» таких вызовов в блоке показателей нет
    const count = (r: ReturnType<typeof draw>) => r.ops.filter((o) => o.startsWith('bezierCurveTo')).length;
    expect(count(frameOf('epic', 14).rec)).toBeGreaterThan(count(frameOf('atlas', 14).rec));
  });

  it('«Неон»: свечение (цветная тень) нигде в оформлении — ни у текста, ни у рамок', () => {
    for (const t of [1, 14, 29.9]) {
      const { rec } = frameOf('neon', t);
      for (const color of rec.shadows) expect(color, `t=${t}`).not.toMatch(/103,\s*217,\s*219|#67D9DB|217,\s*157,\s*184/i);
    }
  });

  it('у «Атласа» нет тени под текстом, у «Экспедиции» — мягкая тёмная', () => {
    expect(frameOf('atlas', 14).rec.shadows.size).toBeLessThanOrEqual(1); // только атрибуция
    expect([...frameOf('epic', 14).rec.shadows].some((c) => /^rgba\(4,\s*9,\s*16/.test(c))).toBe(true);
  });

  it('«Атлас» и «Экспедиция» в одном кадре рисуют по-разному (разные шрифты, цвета и композиция)', () => {
    const a = frameOf('atlas', 28).rec.ops.join('\n');
    const e = frameOf('epic', 28).rec.ops.join('\n');
    expect(a).not.toBe(e);
  });

  it.each(['ru', 'en'] as Lang[])('%s: появление текста — fade со сдвигом по стилю; первый кадр интро не пустой', (lang) => {
    for (const id of STYLE_IDS) {
      const s = cfg({ styleId: id, lang });
      const first = draw(timelineOf(s).frameAt(0), s);
      expect(first.texts.length, `${id} t=0`).toBeGreaterThan(2);
    }
  });
});

describe('финал: последний кадр — итог, показатели пути погашены', () => {
  it.each(FORMATS)('%s: на последнем кадре итоги читаются целиком, без прозрачности и анимации набора', (format) => {
    const s = cfg({ format });
    const tl = timelineOf(s);
    const last = tl.frameAt(tl.durationSec);
    expect(last.outroAlpha).toBe(1);
    const a = draw(last, s);
    const b = draw(tl.frameAt(tl.durationSec - 0.5), s);
    expect(glued(a.texts)).toContain('5 880');
    expect(glued(a.texts)).not.toContain('6 601');
    expect(glued(a.texts)).toContain('2 313');
    // две секунды до конца картинка не меняется (камера стоит, число набрано)
    expect(b.ops).toEqual(a.ops);
  });
});

describe('появление текста: сдвиг по стилю (история 72: у «Атласа» fade + 8–12 дпикс)', () => {
  /** Наибольшее отклонение базовой линии текста от обычного (самого частого) положения, по всем кадрам ролика. */
  function maxShift(styleId: StyleId): number {
    const s = cfg({ styleId, on: ['distance', 'progress', 'country', 'day'], lang: 'ru' });
    const tl = timelineOf(s);
    const ys = new Map<string, number[]>();
    for (let t = 0; t <= tl.durationSec; t += 1 / 15) {
      const fr = tl.frameAt(t);
      for (const p of draw(fr, s).placed) {
        if (/^[\d\s,. −-]$/.test(p.text)) continue; // цифры счёта: у них своя анимация набора
        const key = `${fr.act}|${p.text}@${Math.round(p.x / 20)}`; // элемент = акт + текст + колонка
        (ys.get(key) ?? ys.set(key, []).get(key)!).push(p.y);
      }
    }
    let worst = 0;
    for (const list of ys.values()) {
      const count = new Map<number, number>();
      for (const y of list) count.set(Math.round(y), (count.get(Math.round(y)) ?? 0) + 1);
      const rest = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (const y of list) worst = Math.max(worst, Math.abs(y - rest));
    }
    return worst;
  }

  it('«Атлас»: все появления — сдвиг не больше 12 дпикс (заголовок, плашка, карточки, показатели, итоги)', () => {
    const shift = maxShift('atlas');
    expect(shift).toBeGreaterThan(0); // сдвиг вообще есть
    expect(shift).toBeLessThanOrEqual(12);
  });

  it('«Экспедиция» сдвигается заметнее «Атласа», «Неон» — только fade: тест различает стили', () => {
    expect(maxShift('epic')).toBeGreaterThan(12);
    expect(maxShift('neon')).toBeLessThanOrEqual(1);
  });
});

describe('вход в финал: слои не бывают видны вместе (ревью F4)', () => {
  it.each(FORMATS)('%s, 30 с: на каждом кадре 25,5–28 с заголовок и плашка страны, а также итоги и показатели пути — врозь', (format) => {
    const s = cfg({ format, on: ['distance', 'progress', 'country', 'day'] });
    const tl = timelineOf(s);
    let titleSeen = false, hudSeen = false;
    for (let t = 25.5; t <= 28; t += 1 / 30) {
      const texts = draw(tl.frameAt(t), s).texts;
      const title = texts.includes(AUTHOR); // подпись автора рисуется только вместе с заголовком
      const summary = texts.includes('ИТОГ ПОЕЗДКИ');
      const plaque = texts.some((x) => /^[A-Z]{2}$/.test(x)); // флаг без картинки в Node — код страны на плашке
      const stats = texts.includes('Участки и разрывы');
      expect(title && plaque, `t=${t.toFixed(2)}: заголовок вместе с плашкой страны`).toBe(false);
      expect(title && stats, `t=${t.toFixed(2)}: заголовок вместе с показателями`).toBe(false);
      expect(summary && stats, `t=${t.toFixed(2)}: итоги вместе с показателями`).toBe(false);
      expect(summary && plaque, `t=${t.toFixed(2)}: итоги вместе с плашкой`).toBe(false);
      titleSeen ||= title; hudSeen ||= stats;
    }
    expect(hudSeen && titleSeen, 'на отрезке видны и оформление пути, и заголовок финала').toBe(true);
  });
});

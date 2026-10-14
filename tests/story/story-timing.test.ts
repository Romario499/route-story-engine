// Тайминг истории второго захода: акты по таблице, одна подпись, выдержка финала, детерминизм, плашки от t.
import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { beatTitle } from '../../src/i18n';
import { buildRoute, parseRouteText } from '../../src/route';
import { overviewPaddingFor } from '../../src/render/layout';
import { ACTS, OUTRO_HOLD_SEC, READ_LONG_SEC, READ_MIN_SEC, buildTimeline } from '../../src/story';
import { FPS, MAP_VIEWPORT, type Beat, type CameraState, type Enrichment, type FrameState, type Route } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';
import sampleGpx from '../../public/samples/wahrier-reconstruction.gpx?raw';
import { eastLine, enrichmentFor, georgia, lineRoute, ok, rng, settings, track, yerevan } from './fixtures';

const DURATIONS = [15, 30, 45, 60] as const;
const TABLE = { 15: [2.5, 12], 30: [3, 26], 45: [4, 40], 60: [5, 54] } as const;

const geo = createGeoIndex(JSON.parse(countriesRaw) as CountriesJson, JSON.parse(placesRaw) as PlacesJson);
function wahrier(): { route: Route; enr: Enrichment } {
  const parsed = parseRouteText('wahrier-reconstruction.gpx', sampleGpx);
  if (!parsed.ok) throw new Error(parsed.error);
  const route = ok(buildRoute(parsed.tracks));
  return { route, enr: enrichRoute(route, geo) };
}
const sample = wahrier();

const all = (tl: { frameCount: number; frameAt(t: number): FrameState }) =>
  Array.from({ length: tl.frameCount + 1 }, (_, i) => tl.frameAt(i / FPS));

const mx = (lon: number) => lon / 360 + 0.5;
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
/** Экранная позиция точки (CSS-пиксели кадра, плоская камера). */
function screenOf(cam: CameraState, p: [number, number], vp: { width: number; height: number }): { x: number; y: number } {
  const world = 512 * 2 ** cam.zoom;
  return { x: vp.width / 2 + (mx(p[0]) - mx(cam.center[0])) * world, y: vp.height / 2 + (my(p[1]) - my(cam.center[1])) * world };
}

describe('акты по таблице (история 75)', () => {
  it('ACTS совпадает с раскадровкой ТЗ', () => {
    for (const d of DURATIONS) expect([ACTS[d].intro, ACTS[d].journeyEnd]).toEqual([...TABLE[d]]);
  });

  for (const d of DURATIONS) {
    it(`${d} с: границы актов ±0,1 с, число кадров`, () => {
      const route = lineRoute(600);
      const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: d }));
      expect(tl.frameCount).toBe(d * FPS);
      const fs = all(tl);
      const firstOf = (act: FrameState['act']) => fs.find((f) => f.act === act)!.t;
      expect(Math.abs(firstOf('journey') - TABLE[d][0])).toBeLessThanOrEqual(0.1);
      expect(Math.abs(firstOf('outro') - TABLE[d][1])).toBeLessThanOrEqual(0.1);
      const order = fs.map((f) => ['intro', 'journey', 'outro'].indexOf(f.act));
      for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    });
  }
});

describe('интро (история 76)', () => {
  for (const d of DURATIONS) {
    it(`${d} с: название появляется ≤ 0,4 с, полностью видно ≥ 1,5 с, без карточек и цифр`, () => {
      const route = lineRoute(600);
      const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: d }));
      const step = 0.005;
      const first = tl.frameAt(0);
      expect(first.introAlpha, 'первый кадр не пустой').toBeGreaterThan(0.2);
      expect(first.camera.pitch).toBe(0);
      let full = 0;
      let run = 0;
      let appeared = -1;
      for (let t = 0; t < ACTS[d].intro; t += step) {
        const f = tl.frameAt(t);
        if (f.introAlpha >= 0.999) {
          run += step;
          full = Math.max(full, run);
          if (appeared < 0) appeared = t;
        } else run = 0;
        expect(f.act).toBe('intro');
        expect(f.cards).toEqual([]);
        expect(f.stats.country).toBeNull();
        expect(f.stats.place).toBeNull();
        expect(f.stats.day).toBeUndefined();
        expect(f.stats.speedKmh).toBeUndefined();
        expect(f.countryChange).toBeUndefined();
        expect(f.outroAlpha).toBe(0);
      }
      expect(appeared).toBeGreaterThanOrEqual(0);
      expect(appeared).toBeLessThanOrEqual(0.4);
      expect(full).toBeGreaterThanOrEqual(READ_MIN_SEC - 0.02);
      expect(tl.frameAt(ACTS[d].intro).introAlpha).toBe(0);
    });
  }

  it('первый кадр — общий план всего маршрута', () => {
    for (const format of ['9:16', '16:9'] as const) {
      const route = lineRoute(600, { stepDeg: 0.005 });
      const cam = buildTimeline(route, enrichmentFor(route), settings({ format, durationSec: 15 })).frameAt(0).camera;
      const vp = MAP_VIEWPORT[format];
      const [a, b, c, d] = route.bbox;
      for (const p of [[a, b], [c, d]] as [number, number][]) {
        const s = screenOf(cam, p, vp);
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(vp.width);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(vp.height);
      }
    }
  });
});

describe('одна подпись за раз (история 77), пример @wahrier', () => {
  const collect = (d: 15 | 60) => {
    const tl = buildTimeline(sample.route, sample.enr, settings({ durationSec: d, lang: 'ru' }));
    const fs = all(tl);
    const byBeat = new Map<Beat, FrameState[]>();
    for (const f of fs) {
      expect(f.cards.length).toBeLessThanOrEqual(1);
      for (const c of f.cards) byBeat.set(c.beat, [...(byBeat.get(c.beat) ?? []), f]);
    }
    return { fs, byBeat };
  };

  for (const d of [15, 60] as const) {
    it(`${d} с: не больше одной карточки; появление 0,25–0,4 с; чтение ≥ 1,5 с (длинная ≥ 2 с); старт и финиш на месте`, () => {
      const { byBeat } = collect(d);
      expect(byBeat.size).toBeGreaterThanOrEqual(2);
      const kinds = new Set([...byBeat.keys()].map((b) => b.kind));
      expect(kinds.has('start')).toBe(true);
      expect(kinds.has('finish')).toBe(true);
      for (const [beat, frames] of byBeat) {
        const alphaOf = (f: FrameState) => f.cards[0].alpha;
        // от первого кадра с alpha > 0 до первого кадра с alpha = 1
        const appear = frames.findIndex((f) => alphaOf(f) >= 0.999) / FPS;
        expect(appear).toBeGreaterThanOrEqual(0.2);
        expect(appear).toBeLessThanOrEqual(0.4);
        const read = frames.filter((f) => alphaOf(f) >= 0.999).length / FPS; // плато чтения: карточка видна полностью
        const long = beatTitle('ru', beat).length > 20;
        expect(read, `${beat.kind} ${beatTitle('ru', beat)}`).toBeGreaterThanOrEqual((long ? READ_LONG_SEC : READ_MIN_SEC) - 1e-9);
      }
    });
  }

  it('в коротком ролике подписей не больше, чем в длинном, а время чтения не сжимается', () => {
    expect(collect(15).byBeat.size).toBeLessThanOrEqual(collect(60).byBeat.size);
  });

  it('при нехватке времени приоритет у старта, въезда в страну и финиша; остановки уступают', () => {
    const route = lineRoute(1000);
    const extra: Beat[] = Array.from({ length: 14 }, (_, k) => ({ kind: 'waypoint' as const, idx: 100 + k * 60, label: `Остановка ${k}` }));
    const enr = enrichmentFor(route, { border: 430, extraBeats: extra });
    const fs = all(buildTimeline(route, enr, settings({ durationSec: 15 })));
    for (const f of fs) expect(f.cards.length).toBeLessThanOrEqual(1);
    const shown = new Set(fs.flatMap((f) => f.cards.map((c) => c.beat.kind)));
    for (const k of ['start', 'country', 'finish'] as const) expect(shown.has(k)).toBe(true);
  });

  it('карточки не заходят в интро и финал', () => {
    const route = lineRoute(1000);
    const enr = enrichmentFor(route, { border: 500 });
    for (const d of DURATIONS) {
      const fs = all(buildTimeline(route, enr, settings({ durationSec: d })));
      for (const f of fs) if (f.act !== 'journey') expect(f.cards, `${d} с, t=${f.t}`).toEqual([]);
    }
  });
});

describe('финал (история 79)', () => {
  it('OUTRO_HOLD_SEC: 2 с при 15, 3 с при ≥ 30', () => {
    expect([15, 30, 45, 60].map(OUTRO_HOLD_SEC)).toEqual([2, 3, 3, 3]);
  });

  for (const d of DURATIONS) {
    it(`${d} с: голова на финише до начала финала, отъезд кончается к началу финала, камера неподвижна ≥ ${OUTRO_HOLD_SEC(d)} с, итог на последнем кадре`, () => {
      const route = lineRoute(900);
      const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: d }));
      const fs = all(tl);
      const last = route.points.length - 1;
      const outroStart = fs.findIndex((f) => f.act === 'outro');
      expect(fs[outroStart - 1].head).toBe(last);
      const hold = OUTRO_HOLD_SEC(d);
      // маршрут раскрыт к началу финала: дальше камера стоит до конца ролика
      const still = fs.filter((f) => f.t >= TABLE[d][1] - 1e-9);
      expect(still[still.length - 1].t - still[0].t).toBeGreaterThanOrEqual(hold - 1e-9);
      for (const f of still) expect(f.camera).toEqual(still[0].camera);
      expect(still[0].camera.pitch).toBe(0);
      for (const f of fs.filter((x) => x.t >= d - hold - 1e-9)) expect(f.outroAlpha, `t=${f.t}`).toBe(1);
      // непосредственно до начала финала камера ещё отъезжает
      expect(tl.frameAt(TABLE[d][1] - 0.3).camera).not.toEqual(still[0].camera);
      const end = tl.frameAt(d);
      expect(end.outroAlpha).toBe(1);
      expect(end.showFinish).toBe(true);
      expect(end.cards).toEqual([]);
    });
  }
});

describe('детерминизм (история 75, G30)', () => {
  const synthetic = lineRoute(1000);
  const cases: [string, Route, Enrichment, 15 | 30 | 45 | 60][] = [
    ['пример @wahrier, 15 с', sample.route, sample.enr, 15],
    ['пример @wahrier, 60 с', sample.route, sample.enr, 60],
    ['синтетика, 30 с', synthetic, enrichmentFor(synthetic, { border: 500 }), 30],
  ];
  for (const [name, route, enr, d] of cases) {
    it(`${name}: 20 случайных t в любом порядке дают те же кадры, что последовательный проход`, () => {
      const rnd = rng(42);
      const ts = Array.from({ length: 20 }, () => rnd() * d);
      const tlA = buildTimeline(route, enr, settings({ durationSec: d }));
      const random = ts.map((t) => tlA.frameAt(t));
      const tlB = buildTimeline(route, enr, settings({ durationSec: d }));
      for (let i = 0; i < tlB.frameCount; i++) tlB.frameAt(i / FPS); // последовательный просмотр
      ts.forEach((t, i) => expect(tlB.frameAt(t)).toEqual(random[i]));
      // и повторный вызов в обратном порядке на том же объекте
      [...ts].reverse().forEach((t, i) => expect(tlA.frameAt(t)).toEqual(random[ts.length - 1 - i]));
    });
  }
});

describe('смена страны и «рядом» от t (история 80)', () => {
  const border = 500;
  const route = lineRoute(1000);
  const enr = enrichmentFor(route, { border });
  const tl = buildTimeline(route, enr, settings({ durationSec: 30 }));
  const fs = all(tl);

  it('countryChange: первая страна появляется со стартом путешествия, смена — в момент пересечения границы', () => {
    const journey = fs.filter((f) => f.act === 'journey');
    expect(journey[0].countryChange).toEqual({ from: null, to: georgia, at: 3 });
    const crossing = journey.find((f) => f.head >= border)!;
    const before = journey[journey.indexOf(crossing) - 1];
    expect(before.countryChange!.to).toBe(georgia);
    expect(crossing.countryChange!.from).toBe(georgia);
    expect(crossing.countryChange!.to!.iso2).toBe('AM');
    expect(crossing.t - crossing.countryChange!.at).toBeGreaterThanOrEqual(0);
    expect(crossing.t - crossing.countryChange!.at).toBeLessThan(2 / FPS);
    // страна в цифрах совпадает с плашкой на каждом кадре
    for (const f of journey) expect(f.stats.country).toBe(f.countryChange!.to);
    // в финале плашка остаётся последней страной
    expect(fs[fs.length - 1].countryChange!.to!.iso2).toBe('AM');
  });

  it('placeChange: at — момент смены ближайшего места, visible — есть ли что показывать', () => {
    const journey = fs.filter((f) => f.act === 'journey');
    expect(journey[0].placeChange!.visible).toBe(true);
    const crossing = journey.find((f) => f.stats.place === yerevan)!;
    expect(crossing.placeChange!.at).toBeGreaterThan(3);
    expect(crossing.placeChange!.at).toBeLessThanOrEqual(crossing.t);
    // «at» не меняется, пока место то же
    for (const f of journey.filter((x) => x.stats.place === yerevan)) expect(f.placeChange!.at).toBe(crossing.placeChange!.at);
    // нет места рядом — visible: false
    const none = buildTimeline(route, { ...enr, placeAt: () => null }, settings({ durationSec: 30 }));
    expect(none.frameAt(15).placeChange).toEqual({ at: 3, visible: false });
    expect(none.frameAt(15).stats.place).toBeNull();
  });
});

describe('камера в пути держит голову вне зоны показателей (история 78)', () => {
  for (const format of ['9:16', '16:9'] as const) {
    it(`${format}: голова в свободной области на всём путешествии`, () => {
      const vp = MAP_VIEWPORT[format];
      const pad = format === '9:16'
        ? { top: 0.12 * vp.height, right: 20, bottom: 0.3 * vp.height, left: 20 }
        : { top: 20, right: 20, bottom: 0.25 * vp.height, left: 0.3 * vp.width };
      const pts = eastLine(3000, { stepDeg: 0.02, lon0: 20 }).map((p, i) => ({ ...p, lat: p.lat + 1.5 * Math.sin(i / 120) }));
      const route = ok(buildRoute([track('a.gpx', [pts])]));
      const tl = buildTimeline(route, enrichmentFor(route), settings({ format, durationSec: 15 }), { journeyPadding: pad });
      // пока камера спускается к старту, голова стоит на нём (общий план → путешествие); ограничение — с её первого шага
      const journey = all(tl).filter((f) => f.act === 'journey' && f.head > 0);
      for (const f of journey) {
        const s = screenOf(f.camera, f.headLonLat, vp);
        const tag = `t=${f.t.toFixed(2)}`;
        expect(s.x, tag).toBeGreaterThanOrEqual(pad.left);
        expect(s.x, tag).toBeLessThanOrEqual(vp.width - pad.right);
        expect(s.y, tag).toBeGreaterThanOrEqual(pad.top);
        expect(s.y, tag).toBeLessThanOrEqual(vp.height - pad.bottom);
      }
    });
  }

  it('нулевой отступ — камера прежняя', () => {
    const route = lineRoute(1000);
    const a = buildTimeline(route, enrichmentFor(route), settings()).frameAt(15).camera;
    const zero = { top: 0, right: 0, bottom: 0, left: 0 };
    const b = buildTimeline(route, enrichmentFor(route), settings(), { journeyPadding: zero }).frameAt(15).camera;
    expect(b.center[0]).toBeCloseTo(a.center[0], 9);
    expect(b.center[1]).toBeCloseTo(a.center[1], 9);
  });
});

describe('тайминг не читает медиазапросы (история 62)', () => {
  it('в исходниках src/story нет matchMedia, prefers-reduced-motion, window и document', () => {
    const sources = import.meta.glob('../../src/story/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(3);
    for (const [file, raw] of Object.entries(sources)) {
      const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); // комментарии не в счёт
      expect(text, file).not.toMatch(/matchMedia|prefers-reduced-motion|\bwindow\b|\bdocument\b/);
    }
  });
});

describe('мягкий вход в путешествие и выход в финал (история 118)', () => {
  it('скорость центра камеры меняется ≤ 3 px/кадр на нырке, отъезде и во всём ролике', () => {
    const pts = eastLine(3000, { stepDeg: 0.02, lon0: 20 }).map((p, i) => ({ ...p, lat: p.lat + 1.5 * Math.sin(i / 120) }));
    const route = ok(buildRoute([track('a.gpx', [pts])]));
    for (const d of DURATIONS) {
      for (const format of ['9:16', '16:9'] as const) {
        const fs = all(buildTimeline(route, enrichmentFor(route), settings({ format, durationSec: d })));
        const v = fs.slice(1).map((f, i) => {
          const a = fs[i].camera, b = f.camera;
          const world = 512 * 2 ** Math.max(a.zoom, b.zoom);
          return Math.hypot((mx(b.center[0]) - mx(a.center[0])) * world, (my(b.center[1]) - my(a.center[1])) * world);
        });
        for (let i = 1; i < v.length; i++) expect(Math.abs(v[i] - v[i - 1]), `${d} с ${format}, кадр ${i}`).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('плашки не мигают, подписи не опережают события (ревью F1, F2)', () => {
  const MIN_GAP = 1 - 1e-9;
  const steps = (fs: FrameState[], pick: (f: FrameState) => { at: number } | undefined) => {
    const ats: number[] = [];
    for (const f of fs) { const c = pick(f); if (c && ats[ats.length - 1] !== c.at) ats.push(c.at); }
    return ats;
  };
  for (const d of [15, 30, 60] as const) {
    it(`пример @wahrier, ${d} с: смены страны и «рядом» не чаще раза в секунду, A→B→A схлопнуты`, () => {
      const fs = all(buildTimeline(sample.route, sample.enr, settings({ durationSec: d })));
      for (const pick of [(f: FrameState) => f.countryChange, (f: FrameState) => f.placeChange]) {
        const ats = steps(fs, pick);
        expect(ats.length).toBeGreaterThan(1);
        for (let i = 1; i < ats.length; i++) expect(ats[i] - ats[i - 1], `смены ${ats[i - 1].toFixed(2)} → ${ats[i].toFixed(2)}`).toBeGreaterThanOrEqual(MIN_GAP);
      }
      // нет возврата в ту же страну сразу после короткой смены
      const iso = fs.filter((f) => f.countryChange).map((f) => f.countryChange!);
      const uniq = iso.filter((c, i) => i === 0 || c.at !== iso[i - 1].at);
      for (let i = 2; i < uniq.length; i++) {
        if (uniq[i].to?.iso2 === uniq[i - 2].to?.iso2) expect(uniq[i].at - uniq[i - 1].at).toBeGreaterThanOrEqual(MIN_GAP);
      }
    });

    it(`пример @wahrier, ${d} с: «Финиш» не раньше прихода головы, карточка страны не раньше своей смены более чем на 0,3 с`, () => {
      const fs = all(buildTimeline(sample.route, sample.enr, settings({ durationSec: d })));
      const last = sample.route.points.length - 1;
      const arrival = fs.find((f) => f.head >= last)!.t;
      const firstSeen = new Map<Beat, number>();
      for (const f of fs) for (const c of f.cards) if (!firstSeen.has(c.beat)) firstSeen.set(c.beat, f.t);
      const finish = [...firstSeen].find(([b]) => b.kind === 'finish');
      expect(finish, 'карточка финиша есть').toBeDefined();
      expect(finish![1]).toBeGreaterThanOrEqual(arrival - 1 / FPS);
      const changes = fs.filter((f) => f.countryChange).map((f) => f.countryChange!);
      for (const [beat, t0] of firstSeen) {
        if (beat.kind !== 'country') continue;
        const match = changes.find((c) => c.to?.iso2 === beat.country?.iso2 && t0 >= c.at - 0.3 - 1 / FPS && t0 <= c.at + 1);
        expect(match, `страна ${beat.country?.iso2}, карточка с ${t0.toFixed(2)}`).toBeDefined();
      }
    });
  }
});

describe('такты истории (история 130): общий план → спуск к старту → путь → прибытие → отъезд к полному маршруту', () => {
  /** Доля путешествия, которую голова стоит на старте, пока камера садится (30 с: 3…7 с). */
  const DIVE_SHARE = 4 / 23;
  for (const format of ['9:16', '16:9'] as const) {
    for (const d of DURATIONS) {
      for (const styleId of ['epic', 'atlas'] as const) {
      it(`${styleId} ${format}, ${d} с: общий план в рабочей зоне, спуск кончается к ${ (ACTS[d].intro + DIVE_SHARE * (ACTS[d].journeyEnd - ACTS[d].intro)).toFixed(1) } с, прибытие до отъезда, отъезд кончается к началу финала`, () => {
        const vp = MAP_VIEWPORT[format];
        const pad = overviewPaddingFor(format, styleId);
        const { intro, journeyEnd } = ACTS[d];
        const tl = buildTimeline(sample.route, sample.enr, settings({ durationSec: d, format, styleId }), { overviewPadding: pad });
        const fs = all(tl);
        const inWorkArea = (cam: CameraState) => {
          const [a, b, c, e] = sample.route.bbox;
          return ([[a, b], [a, e], [c, b], [c, e]] as [number, number][]).every((p) => {
            const q = screenOf(cam, p, vp);
            return q.x >= pad.left - 0.5 && q.x <= vp.width - pad.right + 0.5 && q.y >= pad.top - 0.5 && q.y <= vp.height - pad.bottom + 0.5;
          });
        };
        // 0 … вход названия: общий план, весь bbox в рабочей зоне, камера не движется
        const first = tl.frameAt(0).camera;
        expect(first.pitch).toBe(0);
        expect(inWorkArea(first)).toBe(true);
        expect(tl.frameAt(intro - 0.7).camera).toEqual(first);

        // спуск: голова трогается со старта, когда камера уже села на путешествие
        const moved = fs.find((f) => f.head > 0)!;
        const expectStart = intro + DIVE_SHARE * (journeyEnd - intro);
        expect(Math.abs(moved.t - expectStart)).toBeLessThanOrEqual(0.25);
        expect(moved.camera.pitch).toBeGreaterThanOrEqual(0.999);
        const duringDive = tl.frameAt(intro + 0.5 * (moved.t - intro));
        expect(duringDive.act).toBe('journey');
        expect(duringDive.head).toBe(0);
        expect(duringDive.camera.zoom).toBeGreaterThan(first.zoom);
        expect(duringDive.camera.zoom).toBeLessThan(moved.camera.zoom);
        expect(duringDive.camera.pitch).toBeGreaterThan(0);
        expect(duringDive.camera.pitch).toBeLessThan(1);

        // прибытие: голова на финише раньше, чем начался отъезд; отъезд кончается ровно к началу финала
        const last = sample.route.points.length - 1;
        const arrival = fs.find((f) => f.head >= last)!;
        expect(arrival.t).toBeGreaterThanOrEqual(intro + 0.7 * (journeyEnd - intro));
        expect(arrival.t).toBeLessThan(journeyEnd);
        const end = tl.frameAt(journeyEnd).camera;
        expect(end.pitch).toBe(0);
        expect(inWorkArea(end)).toBe(true);
        expect(tl.frameAt(d).camera).toEqual(end);
        // на полпути отъезда камера ещё наклонена и общий план не достигнут
        const mid = tl.frameAt((arrival.t + journeyEnd) / 2).camera;
        expect(mid.pitch).toBeGreaterThan(0);
        expect(inWorkArea(mid)).toBe(false);
      });
      }
    }
  }

  it('30 с: голова трогается в 7 с, прибывает между 22 и 26 с', () => {
    const tl = buildTimeline(sample.route, sample.enr, settings({ durationSec: 30 }));
    const fs = all(tl);
    expect(fs.find((f) => f.head > 0)!.t).toBeCloseTo(7, 0);
    const arrival = fs.find((f) => f.head >= sample.route.points.length - 1)!.t;
    expect(arrival).toBeGreaterThanOrEqual(22);
    expect(arrival).toBeLessThanOrEqual(26);
  });

  it('подпись «Старт» показывается во время спуска, до того как голова тронулась', () => {
    for (const d of DURATIONS) {
      const fs = all(buildTimeline(sample.route, sample.enr, settings({ durationSec: d })));
      const startCard = fs.find((f) => f.cards.some((c) => c.beat.kind === 'start'))!;
      expect(startCard, `${d} с`).toBeDefined();
      expect(startCard.head).toBe(0);
      expect(startCard.t).toBeGreaterThanOrEqual(ACTS[d].intro);
    }
  });
});

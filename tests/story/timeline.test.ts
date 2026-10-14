import { describe, expect, it } from 'vitest';
import { buildRoute } from '../../src/route';
import { ACTS, buildTimeline } from '../../src/story';
import { FPS, type Beat, type FrameState, type TrackPoint } from '../../src/types';
import { T0, dAt, eastLine, enrichmentFor, lineRoute, ok, settings, track } from './fixtures';

function frames(tl: { frameCount: number; frameAt(t: number): FrameState }): FrameState[] {
  return Array.from({ length: tl.frameCount }, (_, i) => tl.frameAt(i / FPS));
}
const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];

describe('buildTimeline — акты и длина', () => {
  for (const durationSec of [15, 30, 60] as const) {
    it(`${durationSec} с: число кадров, доли актов по таблице ТЗ`, () => {
      const route = lineRoute(500);
      const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec }));
      expect(tl.durationSec).toBe(durationSec);
      expect(tl.frameCount).toBe(durationSec * FPS);
      expect(tl.frameAt(0).act).toBe('intro');
      expect(tl.frameAt(durationSec / 2).act).toBe('journey');
      expect(tl.frameAt(durationSec).act).toBe('outro');
      const fs = frames(tl);
      const share = (act: FrameState['act']) => fs.filter((f) => f.act === act).length / fs.length;
      const { intro, journeyEnd } = ACTS[durationSec];
      expect(share('intro')).toBeCloseTo(intro / durationSec, 1);
      expect(share('journey')).toBeCloseTo((journeyEnd - intro) / durationSec, 1);
      expect(share('outro')).toBeCloseTo((durationSec - journeyEnd) / durationSec, 1);
      // акты идут по порядку
      const order = fs.map((f) => ['intro', 'journey', 'outro'].indexOf(f.act));
      for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
    });
  }
});

describe('buildTimeline — темп «головы»', () => {
  it('head не убывает и доходит до последней точки до начала финала', () => {
    const route = lineRoute(800);
    const tl = buildTimeline(route, enrichmentFor(route), settings());
    const fs = frames(tl);
    for (let i = 1; i < fs.length; i++) expect(fs[i].head).toBeGreaterThanOrEqual(fs[i - 1].head);
    expect(fs[0].head).toBe(0);
    const last = route.points.length - 1;
    const reached = fs.findIndex((f) => f.head >= last);
    expect(reached).toBeGreaterThan(0);
    expect(fs[reached].act).toBe('journey');
    expect(fs[fs.length - 1].head).toBe(last);
    expect(fs[fs.length - 1].showFinish).toBe(true);
    expect(fs[Math.floor(fs.length / 2)].showFinish).toBe(false);
  });

  it('переезд проходится быстрее, чем такой же отрезок своим ходом', () => {
    // A: 300 точек ≈ 25 км, разрыв ≈ 25 км (граница файлов = переезд), B: ещё ≈ 25 км
    const a = eastLine(300, { lon0: 40 });
    const b = eastLine(300, { lon0: 40 + 0.299 + 0.3 });
    const route = ok(buildRoute([track('a.gpx', [a]), track('b.gpx', [b])]));
    expect(route.transfers).toHaveLength(1);
    const { fromIdx, toIdx } = route.transfers[0];
    const enr = enrichmentFor(route, { beats: [{ kind: 'start', idx: 0 }, { kind: 'finish', idx: route.points.length - 1 }] });
    const fs = frames(buildTimeline(route, enr, settings({ durationSec: 30 })));
    const speeds = (pred: (h: number) => boolean) => {
      const out: number[] = [];
      for (let i = 1; i < fs.length; i++) if (fs[i].act === 'journey' && pred(fs[i - 1].head) && pred(fs[i].head)) out.push(dAt(route, fs[i].head) - dAt(route, fs[i - 1].head));
      return out;
    };
    const inTransfer = speeds((h) => h > fromIdx && h < toIdx);
    const own = speeds((h) => (h > 100 && h < fromIdx - 50) || (h > toIdx + 50 && h < route.points.length - 100));
    expect(inTransfer.length).toBeGreaterThan(0);
    expect(median(inTransfer)).toBeGreaterThan(2 * median(own));
    // по времени: на переезд ушло меньше кадров, чем на столь же длинный кусок своим ходом
    const transferM = route.points[toIdx].d - route.points[fromIdx].d;
    const ownMPerFrame = median(own);
    expect(inTransfer.length).toBeLessThan(transferM / ownMPerFrame);
  });

  it('рядом с битом «голова» притормаживает', () => {
    const route = lineRoute(1000);
    const beats: Beat[] = [
      { kind: 'start', idx: 0 }, { kind: 'peak', idx: 500, ele: 2000 }, { kind: 'finish', idx: 999 },
    ];
    const fs = frames(buildTimeline(route, enrichmentFor(route, { beats }), settings({ durationSec: 30 })));
    const step = (i: number) => dAt(route, fs[i + 1].head) - dAt(route, fs[i].head);
    const atBeat = fs.findIndex((f) => f.head >= 500);
    const journey = fs.map((_, i) => i).filter((i) => fs[i].act === 'journey' && i + 1 < fs.length && fs[i + 1].act === 'journey');
    const cruise = median(journey.map(step));
    expect(step(atBeat)).toBeLessThan(0.7 * cruise);
    // старт и финиш тоже мягкие: первые и последние шаги путешествия медленнее крейсерского
    expect(step(journey[0])).toBeLessThan(0.7 * cruise);
  });

  it('маршрут без времени: темп по расстоянию, day/date/speed не определены', () => {
    // первая половина пути — частые точки, вторая — редкие; по расстоянию половины равны
    const dense = eastLine(801, { lon0: 40, stepDeg: 0.0005 });
    const sparse = eastLine(200, { lon0: 40 + 0.4 + 0.002, stepDeg: 0.002 });
    const route = ok(buildRoute([track('a.csv', [[...dense, ...sparse] as TrackPoint[]])]));
    expect(route.hasTime).toBe(false);
    const enr = enrichmentFor(route, { beats: [{ kind: 'start', idx: 0 }, { kind: 'finish', idx: route.points.length - 1 }] });
    const tl = buildTimeline(route, enr, settings({ durationSec: 30 }));
    const mid = tl.frameAt(30 * (0.1 + 0.78 / 2));
    const share = dAt(route, mid.head) / route.totalM;
    expect(share).toBeGreaterThan(0.4);
    expect(share).toBeLessThan(0.62);
    for (const f of frames(tl)) {
      expect(f.stats.day).toBeUndefined();
      expect(f.stats.date).toBeUndefined();
      expect(f.stats.speedKmh).toBeUndefined();
    }
  });
});

describe('buildTimeline — карточки битов', () => {
  it('карточка: alpha 0→1→0 (появление, чтение, гашение), enter 0→1', () => {
    const route = lineRoute(1000);
    const enr = enrichmentFor(route, { border: 500 });
    const fs = frames(buildTimeline(route, enr, settings({ durationSec: 30 })));
    for (const beat of enr.beats) {
      const seen = fs.map((f, i) => ({ i, c: f.cards.find((c) => c.beat === beat) })).filter((x) => x.c);
      expect(seen.length, `карточка ${beat.kind}`).toBeGreaterThan(0);
      const span = (seen[seen.length - 1].i - seen[0].i + 1) / FPS;
      expect(span).toBeGreaterThan(2.0);
      expect(span).toBeLessThan(2.9);
      const alphas = seen.map((x) => x.c!.alpha);
      expect(Math.max(...alphas)).toBeGreaterThan(0.99);
      expect(alphas[0]).toBeLessThan(0.3);
      expect(alphas[alphas.length - 1]).toBeLessThan(0.3);
      const enters = seen.map((x) => x.c!.enter);
      expect(enters[0]).toBeLessThan(0.3);
      expect(enters[enters.length - 1]).toBe(1);
      for (let k = 1; k < enters.length; k++) expect(enters[k]).toBeGreaterThanOrEqual(enters[k - 1]);
      for (const a of alphas) { expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1); }
    }
  });

  it('одновременно не больше одной карточки, даже если биты идут плотно', () => {
    const route = lineRoute(1000);
    const extra: Beat[] = Array.from({ length: 12 }, (_, k) => ({ kind: 'waypoint' as const, idx: 400 + k * 5, label: `Остановка ${k}` }));
    const enr = enrichmentFor(route, { border: 430, extraBeats: extra });
    const fs = frames(buildTimeline(route, enr, settings({ durationSec: 15 })));
    for (const f of fs) expect(f.cards.length).toBeLessThanOrEqual(1);
    // старт, въезд в страну и финиш не теряются
    const shown = new Set(fs.flatMap((f) => f.cards.map((c) => c.beat.kind)));
    for (const k of ['start', 'country', 'finish']) expect(shown.has(k as Beat['kind'])).toBe(true);
  });
});

describe('buildTimeline — данные кадра', () => {
  it('stats: км растут до totalM/1000; день, дата, скорость, высота — из маршрута; страна и город — из обогащения', () => {
    // 1000 точек раз в 2 мин по ~420 м: ~12,6 км/ч, ~33 ч пути
    const pts = eastLine(1000, { stepDeg: 0.005, t0: T0, dtSec: 120, ele: (i) => 100 + i });
    const route = ok(buildRoute([track('a.gpx', [pts])]));
    expect(route.hasTime).toBe(true);
    const border = 600;
    const enr = enrichmentFor(route, { border });
    const tl = buildTimeline(route, enr, settings({ durationSec: 30 }));
    const fs = frames(tl);
    expect(fs[0].stats.distanceKm).toBe(0);
    for (let i = 1; i < fs.length; i++) expect(fs[i].stats.distanceKm).toBeGreaterThanOrEqual(fs[i - 1].stats.distanceKm);
    expect(fs[fs.length - 1].stats.distanceKm).toBeCloseTo(route.totalM / 1000, 6);
    expect(fs[fs.length - 1].stats.progress).toBeCloseTo(1, 6);

    const expectedKmh = ((route.points[1].d - route.points[0].d) / 120) * 3.6;
    for (const f of fs.filter((x) => x.act === 'journey' && x.head > 200 && x.head < 800)) {
      const i = Math.floor(f.head);
      expect(f.stats.day).toBe(route.day![i]);
      expect(f.stats.altitudeM!).toBeCloseTo(100 + f.head, 0);
      expect(f.stats.speedKmh!).toBeGreaterThan(expectedKmh * 0.95);
      expect(f.stats.speedKmh!).toBeLessThan(expectedKmh * 1.05);
      // дата — момент «головы», сдвинутый на солнечный пояс (как день в route.day)
      const shift = Math.round(route.points[i].lon / 15) * 3_600_000;
      expect(f.stats.date!).toBeGreaterThanOrEqual(route.points[i].time! + shift);
      expect(f.stats.date!).toBeLessThanOrEqual(route.points[i + 1].time! + shift);
      expect(f.stats.country).toBe(i < border ? enr.countryAt(0) : enr.countryAt(border));
      expect(f.stats.place).toBe(enr.placeAt(i));
    }
    expect(fs.some((f) => f.stats.day === 2)).toBe(true);
  });

  it('интро — заголовок, финал — итоговая карточка', () => {
    const route = lineRoute(500);
    const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: 30 }));
    expect(tl.frameAt(0).introAlpha).toBeGreaterThan(0.2);
    expect(tl.frameAt(1).introAlpha).toBe(1);
    expect(tl.frameAt(0).outroAlpha).toBe(0);
    expect(tl.frameAt(15).introAlpha).toBe(0);
    expect(tl.frameAt(15).outroAlpha).toBe(0);
    expect(tl.frameAt(30).outroAlpha).toBe(1);
    expect(tl.frameAt(30).introAlpha).toBe(0);
  });

  it('заголовок интро читаем при любой длительности: полностью виден 1,5 с и держится около 2 с', () => {
    for (const durationSec of [15, 30, 45, 60] as const) {
      const route = lineRoute(500);
      const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec }));
      let readable = 0; // секунды, пока заголовок виден не слабее 25%
      for (let t = 0; t < durationSec; t += 0.01) {
        const f = tl.frameAt(t);
        if (f.act === 'intro' && f.introAlpha >= 0.25) readable += 0.01;
        if (t >= 0.4 && t < 1.85) expect(f.introAlpha, `${durationSec} с, t=${t.toFixed(2)}`).toBe(1);
        if (f.act !== 'intro') expect(f.introAlpha).toBe(0);
      }
      expect(readable, `${durationSec} с`).toBeGreaterThanOrEqual(1.9);
    }
  });

  it('общий план держится не меньше 0,8 с до нырка камеры — и в 15-секундной версии', () => {
    const route = lineRoute(500);
    const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: 15 }));
    const c0 = tl.frameAt(0).camera;
    const c1 = tl.frameAt(0.75).camera;
    expect(c1.zoom).toBeCloseTo(c0.zoom, 6);
    expect(c1.center[0]).toBeCloseTo(c0.center[0], 6);
    // спуск идёт к концу интро и кончается, когда голова трогается со старта
    expect(tl.frameAt(3.5).camera.zoom).toBeGreaterThan(c0.zoom + 0.3);
  });
});

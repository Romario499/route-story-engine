import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STYLES } from '../../src/render/styles';
import { drawTrackLayer, prepareTrack, type TrackModel } from '../../src/render/track';
import type { Enrichment, FrameState, Route, RoutePoint, StyleId } from '../../src/types';
import { MAP_VIEWPORT } from '../../src/types';

// Path2D в Node нет: заглушка считает звенья, чтобы отличать пустой контур от рисуемого.
class FakePath2D {
  segments = 0;
  commands: [string, number, number][] = [];
  moveTo(x: number, y: number): void { this.commands.push(['M', x, y]); }
  lineTo(x: number, y: number): void { this.segments++; this.commands.push(['L', x, y]); }
  quadraticCurveTo(): void { this.segments++; }
}
beforeAll(() => { vi.stubGlobal('Path2D', FakePath2D); });
afterAll(() => { vi.unstubAllGlobals(); });

interface StrokeOp { color: string; width: number; dash: number[]; alpha: number; blur: number; blend: string; segments: number | null; commands: [string, number, number][] }

/** Холст-«магнитофон»: каждый stroke/fill записывается вместе с состоянием; сохранение состояния — стеком. */
function recorder() {
  const strokes: StrokeOp[] = [];
  const log: string[] = [];
  const texts: { text: string; x: number; y: number }[] = [];
  const state: Record<string, unknown> = {
    strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1, shadowBlur: 0, globalCompositeOperation: 'source-over', font: '10px sans-serif',
  };
  let dash: number[] = [];
  const stack: [Record<string, unknown>, number[]][] = [];
  const keys = ['strokeStyle', 'fillStyle', 'lineWidth', 'globalAlpha', 'shadowBlur', 'globalCompositeOperation'];
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      switch (prop) {
        case 'save': return () => { stack.push([Object.fromEntries(keys.map((k) => [k, state[k]])), dash]); };
        case 'restore': return () => { const top = stack.pop(); if (top) { Object.assign(state, top[0]); dash = top[1]; } };
        case 'setLineDash': return (d: number[]) => { dash = d; };
        case 'getTransform': return () => ({ a: 2 });
        case 'measureText': return (s: string) => ({ width: s.length * 8 });
        case 'createRadialGradient': return () => ({ addColorStop: () => undefined });
        case 'fillText': return (text: string, x: number, y: number) => { texts.push({ text, x, y }); };
        case 'fill': return () => { log.push(`fill:${state.fillStyle}`); };
        case 'stroke': return (path?: FakePath2D) => {
          strokes.push({
            color: String(state.strokeStyle), width: Number(state.lineWidth), dash: [...dash], alpha: Number(state.globalAlpha),
            blur: Number(state.shadowBlur), blend: String(state.globalCompositeOperation), segments: path ? path.segments : null,
            commands: path?.commands ?? [],
          });
          log.push(`stroke:${state.strokeStyle}:${state.lineWidth}:${path ? path.segments : '-'}`);
        };
        default: return (...args: unknown[]) => { log.push(`${prop}:${args.map((a) => (typeof a === 'number' ? Math.round(a * 100) / 100 : typeof a)).join(',')}`); };
      }
    },
    set(_t, prop: string, value) { state[prop] = value; return true; },
    has: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes, log, texts };
}

/** 7 точек по параллели; переезд перед точкой 4; все точки в display. */
function route(): Route {
  const points: RoutePoint[] = Array.from({ length: 7 }, (_, i) => ({
    lat: 41, lon: 40 + i * 0.05, d: i * 4000, seg: 0, transferBefore: i === 4,
  }));
  return {
    points, display: [0, 1, 2, 3, 4, 5, 6], totalM: 24000, ownM: 20000,
    transfers: [{ fromIdx: 3, toIdx: 4 }], hasTime: false, hasEle: false,
    bbox: [40, 41, 40.3, 41], waypoints: [],
  };
}

function frameAt(head: number, patch: Partial<FrameState> = {}): FrameState {
  const lon = 40 + head * 0.05;
  return {
    t: 10 + head, act: 'journey', head, headLonLat: [lon, 41],
    camera: { center: [40.15, 41], zoom: 9, pitch: 0, bearing: 0 },
    stats: { distanceKm: 0, progress: 0, country: null, place: null },
    cards: [], introAlpha: 0, outroAlpha: 0, showFinish: head >= 6, ...patch,
  };
}

const project = (lon: number, lat: number) => ({ x: (lon - 40) * 1000 + 60, y: 480 + (lat - 41) * 1000 });

function draw(id: StyleId, frame: FrameState, model?: TrackModel) {
  const r = route();
  const rec = recorder();
  drawTrackLayer({
    ctx: rec.ctx, model: model ?? prepareTrack(r), route: r, enrichment: null, lang: 'ru', frame, project,
    style: STYLES[id], view: MAP_VIEWPORT['9:16'],
  });
  return rec;
}

const IDS: StyleId[] = ['epic', 'atlas', 'neon'];

describe('invalid track projections break contours', () => {
  function probe(head: number, invalid: (lon: number) => boolean, patch: Partial<FrameState> = {}, r = route()) {
    const rec = recorder(), model = prepareTrack(r);
    drawTrackLayer({ ctx: rec.ctx, model, route: r, enrichment: null, lang: 'ru', frame: frameAt(head, patch), project,
      projectTrack: (lon: number, lat: number) => invalid(lon) ? null : project(lon, lat),
      style: STYLES.epic, view: MAP_VIEWPORT['9:16'] });
    return { ...rec, model };
  }
  it.each([['done', 6], ['ghost', 0]] as const)('%s: A → invalid B → C → D starts at C, never A → C', (kind, head) => {
    const rec = probe(head, lon => lon === 40.05);
    const paths = rec.strokes.filter(s => s.commands.length && s.color === (kind === 'done' ? STYLES.epic.line.color : STYLES.epic.line.ghost));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(path.commands.some(([op,x]) => op === 'M' && Math.abs(x - 160) < 1e-6)).toBe(true);
      expect(path.commands.some(([op,x]) => op === 'L' && Math.abs(x - 210) < 1e-6)).toBe(true);
      expect(path.commands.some(([,x]) => Math.abs(x - 110) < 1e-6)).toBe(false);
    }
  });
  it('invalid HEAD neither joins a path nor draws a head marker', () => {
    const rec = probe(2.5, lon => lon === 40.125);
    expect(rec.model.have[rec.model.n]).toBe(0);
    expect(rec.log.some(s => s.startsWith('arc:185,480,'))).toBe(false);
    expect(rec.strokes.some(s => s.commands.some(([,x]) => x === 185))).toBe(false);
  });
  it('both endpoints outside the screen can still cross it', () => {
    const r = route(); r.points = r.points.slice(0,2); r.display = [0,1]; r.transfers = [];
    const rec = recorder();
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(r), route:r, enrichment:null,lang:'ru',frame:frameAt(1,{showFinish:true}),
      project: lon => ({x: lon === 40 ? -100 : 1000,y:300}),
      projectTrack: (lon: number) => ({x: lon === 40 ? -100 : 1000,y:300}),style:STYLES.epic,view:MAP_VIEWPORT['9:16'] });
    expect(rec.strokes.some(s => s.commands.some(([op,x]) => op === 'L' && x === 1000))).toBe(true);
  });
  it('a segment boundary breaks the solid path even without transferBefore', () => {
    const r = route(); r.points.forEach((p,i) => { p.seg = i < 3 ? 0 : 1; p.transferBefore = false; });
    const rec = probe(6, () => false, {}, r);
    expect(rec.model.transferSeg[2]).toBe(1);
    for(const path of rec.strokes.filter(s => s.commands.length)) {
      expect(path.commands.some(([op,x]) => op === 'M' && Math.abs(x-210)<1e-6)).toBe(true);
    }
  });
});

describe('drawTrackLayer: линия по профилю стиля', () => {
  it.each(IDS)('%s: основная линия толщиной line.width/2 цвета line.color', (id) => {
    const { strokes } = draw(id, frameAt(5.5));
    const main = strokes.filter((s) => s.color === STYLES[id].line.color && s.alpha === 1 && s.blur === 0 && (s.segments ?? 0) > 0);
    expect(main.length).toBeGreaterThan(0);
    expect(main[0].width).toBeCloseTo(STYLES[id].line.width / 2, 5);
  });

  it.each(['epic', 'neon'] as const)('%s: ровно один проход со свечением, узкий', (id) => {
    const { strokes } = draw(id, frameAt(5.5));
    const glow = strokes.filter((s) => s.blur > 0);
    expect(glow).toHaveLength(1);
    const px = STYLES[id].line.width / 2;
    expect(glow[0].blur).toBeLessThanOrEqual(px * 3 * 2); // не шире трёх толщин в канвас-пикселях (масштаб 2)
    expect(glow[0].color).toBe(STYLES[id].line.glowColor);
  });

  it('«Атлас»: свечения нет — ни размытия, ни режима lighter', () => {
    const { strokes } = draw('atlas', frameAt(5.5));
    expect(strokes.filter((s) => s.blur > 0 || s.blend === 'lighter')).toEqual([]);
  });

  it.each(IDS)('%s: неизвестный путь скрыт, в том числе в обзорах и у HEAD', (id) => {
    for (const frame of [frameAt(0, {act:'intro'}), frameAt(3.5), frameAt(5.5), frameAt(6, {act:'outro'})]) {
      const { strokes, log } = draw(id, frame);
      expect(strokes.filter(s => s.dash.length && (s.segments ?? 0) > 0)).toEqual([]);
      for (const s of strokes.filter(s => s.commands.length)) {
        // Neither a solid line nor a partial HEAD edge may cross 3→4.
        for (let i=1;i<s.commands.length;i++) {
          const [op,x] = s.commands[i], prev = s.commands[i-1][1];
          expect(op === 'L' && prev < 260-1e-6 && x > 210+1e-6).toBe(false);
        }
      }
      if (frame.head === 3.5) expect(log.some(s => s.startsWith('arc:235,480,'))).toBe(false);
    }
  });

  it.each(IDS)('%s: финиш — флаг (залитое полотнище цвета линии), старт — кольцо', (id) => {
    const { log } = draw(id, frameAt(6, { act: 'outro', showFinish: true }));
    expect(log).toContain(`fill:${STYLES[id].line.color}`);          // полотнище флага
    expect(log.some((l) => l.startsWith('closePath'))).toBe(true);
    expect(log.filter((l) => l.startsWith('arc')).length).toBeGreaterThanOrEqual(4); // кольцо старта + основание флага
  });
});

describe('drawTrackLayer: читаемость на любом фоне (V3)', () => {
  it.each(IDS)('%s: остаток пути рисуется на своей подложке, пройденное — на обводке шире линии, подложки идут раньше линий', (id) => {
    const { strokes } = draw(id, frameAt(3.5));
    const L = STYLES[id].line;
    const idx = (pred: (s: StrokeOp) => boolean) => strokes.findIndex((s) => pred(s) && (s.segments ?? 0) > 0);
    const ghostCasing = idx((s) => s.color === L.ghostCasing);
    const ghost = idx((s) => s.color === L.ghost);
    const casing = idx((s) => s.color === L.casing.color && s.width > L.width / 2);
    const main = idx((s) => s.color === L.color && s.blur === 0);
    expect(ghostCasing).toBeGreaterThanOrEqual(0);
    expect(ghost).toBe(ghostCasing + 1);
    // подложка остатка чуть шире самого следа, а обводка пройденного — в casing.scale раз шире линии
    expect(strokes[ghostCasing].width).toBeGreaterThan(strokes[ghost].width);
    expect(strokes[casing].width).toBeCloseTo((L.width / 2) * L.casing.scale, 5);
    expect(casing).toBeLessThan(main);
  });

  it('«Экспедиция»: остаток тоньше и бледнее пройденного', () => {
    const { strokes } = draw('epic', frameAt(3.5));
    const L = STYLES.epic.line;
    const ghost = strokes.find((s) => s.color === L.ghost && (s.segments ?? 0) > 0)!;
    const main = strokes.find((s) => s.color === L.color && s.blur === 0 && (s.segments ?? 0) > 0)!;
    expect(ghost.width).toBeLessThan(main.width);
  });
});

describe('drawTrackLayer: подписи старта и финиша не наслаиваются (петля)', () => {
  /** Петля: 8 точек по кругу, последняя в 40 м от первой. */
  function loopRoute(): Route {
    const points: RoutePoint[] = Array.from({ length: 9 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return { lat: 41 + 0.01 * Math.sin(a), lon: 40 + 0.01 * Math.cos(a) - (i === 8 ? 0.0004 : 0), d: i * 1000, seg: 0, transferBefore: false };
    });
    return { points, display: points.map((_, i) => i), totalM: 8000, ownM: 8000, transfers: [], hasTime: false, hasEle: false, bbox: [39.99, 40.99, 40.01, 41.01], waypoints: [] };
  }
  const enr = (route: Route): Enrichment => ({
    countryRuns: [], countries: [], startPlace: null, finishPlace: null, placeAt: () => null, countryAt: () => null,
    beats: [
      { kind: 'start', idx: 0, place: { nameRu: 'Бохинь', nameEn: 'Bohinj', lat: 41, lon: 40, pop: 1 } },
      { kind: 'finish', idx: route.points.length - 1, place: { nameRu: 'Бохинь', nameEn: 'Bohinj', lat: 41, lon: 40, pop: 1 } },
    ],
  });
  // 1 км ≈ 0.009° — на карте zoom 14 это десятки пикселей: старт и финиш ближе ширины подписи
  const loopProject = (lon: number, lat: number) => ({ x: 270 + (lon - 40) * 9000, y: 480 - (lat - 41) * 9000 });

  function drawLoop(id: StyleId, project = loopProject) {
    const r = loopRoute();
    const rec = recorder();
    const frame = frameAt(8, { act: 'outro', showFinish: true, outroAlpha: 1 });
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(r), route: r, enrichment: enr(r), lang: 'ru', frame, project, style: STYLES[id], view: MAP_VIEWPORT['9:16'] });
    return rec;
  }
  /** Прямоугольники подписей из записанных fillText (размеры — по правилам drawLabel). */
  const boxes = (id: StyleId, texts: { text: string; x: number; y: number }[]) => {
    const fontPx = STYLES[id].type.label.size / 2;
    const padX = fontPx * 0.6, h = fontPx * 1.7;
    return texts.map((t) => ({ text: t.text, x: t.x - padX, y: t.y - h / 2 - 0.5, w: t.text.length * 8 + padX * 2, h }));
  };

  it.each(IDS)('%s: старт и финиш в одной точке — две подписи, и они не пересекаются', (id) => {
    const rec = drawLoop(id);
    const b = boxes(id, rec.texts);
    expect(b.map((x) => x.text).sort()).toEqual(['Старт — Бохинь', 'Финиш — Бохинь'].sort());
    const [p, q] = b;
    const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
    expect(overlap).toBe(false);
  });

  it.each(IDS)('%s: маркеры далеко друг от друга — подпись старта остаётся над ним', (id) => {
    const r = route();
    const rec = recorder();
    drawTrackLayer({
      ctx: rec.ctx, model: prepareTrack(r), route: r, enrichment: { ...enr(loopRoute()), beats: [{ kind: 'start', idx: 0 }, { kind: 'finish', idx: 6 }] } as Enrichment, lang: 'ru',
      frame: frameAt(6, { act: 'outro', showFinish: true }), project, style: STYLES[id], view: MAP_VIEWPORT['9:16'],
    });
    const start = rec.texts.find((t) => t.text.startsWith('Старт'))!;
    expect(start.y).toBeLessThan(project(40, 41).y); // выше маркера старта (y растёт вниз)
  });
});

describe('drawTrackLayer: всё от кадра (детерминизм seek)', () => {
  it.each(IDS)('%s: кадр после перемотки рисуется так же, как на свежей модели', (id) => {
    const target = frameAt(6, { t: 29.5, showFinish: true, act: 'journey' });
    const fresh = draw(id, target).log;
    const model = prepareTrack(route());
    for (const f of [frameAt(2.5), frameAt(6, { t: 28.9 }), frameAt(1.1), target]) draw(id, f, model);
    const afterSeek = draw(id, target, model).log;
    expect(afterSeek).toEqual(fresh);
  });
});

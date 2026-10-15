// Слой «маршрут по меткам» на холсте (история 141): ночёвка, остановка и поезд — разные знаки; соединения — пунктиром по виду
// участка, ни один не рисуется сплошной линией трека. Синтетика; холст-«магнитофон»; значки — подменой drawIcon.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const iconCalls: string[] = [];
vi.mock('../../src/render/assets', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/render/assets')>();
  return { ...original, drawIcon: (...args: Parameters<typeof original.drawIcon>) => { iconCalls.push(args[1]); } };
});


import { STYLES } from '../../src/render/styles';
import { drawTrackLayer, prepareTrack } from '../../src/render/track';
import { drawWaypointLayer, legLook } from '../../src/render/waypoint-layer';
import { MAP_VIEWPORT, type FrameState, type StyleId } from '../../src/types';
import { enrichmentFor } from '../story/fixtures';
import { jw, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';

class FakePath2D { moveTo(): void { /* — */ } lineTo(): void { /* — */ } quadraticCurveTo(): void { /* — */ } }
beforeAll(() => { vi.stubGlobal('Path2D', FakePath2D); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { iconCalls.length = 0; });

interface StrokeOp { color: string; width: number; dash: number[]; alpha: number; longest: number }
interface Arc { r: number; fill: string }

/** Холст-«магнитофон»: stroke с состоянием и самым длинным звеном текущего контура; дуги с цветом заливки. */
function recorder() {
  const strokes: StrokeOp[] = [];
  const arcs: Arc[] = [];
  const state: Record<string, unknown> = { strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1, font: '10px sans-serif' };
  let dash: number[] = [];
  let cur: [number, number] = [0, 0];
  let longest = 0;
  const saved: Record<string, unknown>[] = [];
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      switch (prop) {
        case 'save': return () => { saved.push({ ...state }); };
        case 'restore': return () => { Object.assign(state, saved.pop() ?? {}); };
        case 'setLineDash': return (d: number[]) => { dash = d; };
        case 'beginPath': return () => { longest = 0; };
        case 'moveTo': return (x: number, y: number) => { cur = [x, y]; };
        case 'lineTo': return (x: number, y: number) => { longest = Math.max(longest, Math.hypot(x - cur[0], y - cur[1])); cur = [x, y]; };
        case 'arc': return (_x: number, _y: number, r: number) => { arcs.push({ r, fill: String(state.fillStyle) }); };
        case 'stroke': return () => { strokes.push({ color: String(state.strokeStyle), width: Number(state.lineWidth), dash: [...dash], alpha: Number(state.globalAlpha), longest }); };
        case 'getTransform': return () => ({ a: 2 });
        case 'measureText': return (s: string) => ({ width: s.length * 8 });
        case 'createRadialGradient': return () => ({ addColorStop: () => undefined });
        default: return () => undefined;
      }
    },
    set(_t, prop: string, value) { state[prop] = value; return true; },
    has: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, strokes, arcs };
}

// Компактная цепочка (плоская проекция: 40 px на градус, соседние ночёвки в 20 px — значки читаются):
//   0…4 — ночёвки (уницикл), 5 — остановка (оба участка вокруг неё unknown), 6 — ночёвка, 7–8 — поезд (жёлтые), 9–12 — ночёвки.
const MARKS = [
  jw(40, 30, 'overnight', 0), jw(40, 30.5, 'overnight', 1), jw(40, 31, 'overnight', 2), jw(40, 31.5, 'overnight', 3),
  jw(40, 32, 'overnight', 4), jw(40.1, 32.2, 'stop', 4), jw(40, 32.7, 'overnight', 5),
  jw(40.5, 34.7, 'train', 6), jw(40.5, 36.7, 'train', 7), jw(40.5, 37.2, 'overnight', 8),
  jw(40.5, 37.7, 'overnight', 9), jw(40.5, 38.2, 'overnight', 10), jw(40.5, 38.7, 'overnight', 11),
];
const LAST = MARKS.length - 1;
const route = waypointRoute(MARKS);
const enrichment = enrichmentFor(route, { border: 6 });
const view = MAP_VIEWPORT['9:16'];
const SCALE = 40;
const CENTER = { lon: 34.5, lat: 40.2 };
const project = (lon: number, lat: number, scale = SCALE) => ({ x: view.width / 2 + (lon - CENTER.lon) * scale, y: view.height / 2 - (lat - CENTER.lat) * scale });

function frameOf(head: number, act: FrameState['act'] = 'journey'): FrameState {
  const i = Math.min(LAST - 1, Math.floor(head)), f = head - i;
  const a = MARKS[i], b = MARKS[i + 1];
  return {
    t: 10, act, head, headLonLat: [a.lon + (b.lon - a.lon) * f, a.lat + (b.lat - a.lat) * f],
    camera: { center: [CENTER.lon, CENTER.lat], zoom: 5, pitch: 1, bearing: 0 },
    stats: { distanceKm: 0, progress: head / LAST, country: null, place: null },
    cards: [], introAlpha: 0, outroAlpha: 0, showFinish: head >= LAST,
  };
}

function layerArgs(frame: FrameState, styleId: StyleId, scale: number) {
  const rec = recorder();
  const args = { ctx: rec.ctx, route, frame, style: STYLES[styleId], view, project: (lon: number, lat: number) => project(lon, lat, scale) };
  return { rec, args };
}
const drawLayer = (frame: FrameState, styleId: StyleId = 'epic', scale = SCALE) => {
  const { rec, args } = layerArgs(frame, styleId, scale);
  drawWaypointLayer(args);
  return rec;
};
const drawTrack = (frame: FrameState, styleId: StyleId = 'epic', scale = SCALE) => {
  const { rec, args } = layerArgs(frame, styleId, scale);
  drawTrackLayer({ ...args, model: prepareTrack(route), enrichment, lang: 'ru' });
  return rec;
};

describe('соединения между метками — только пунктиром (история 141)', () => {
  it('ни одно звено не рисуется сплошной линией: у каждого штрих задан и не пустой — во всех стилях и на всех стадиях', () => {
    for (const styleId of ['epic', 'atlas', 'neon'] as const) {
      for (const frame of [frameOf(0, 'intro'), frameOf(3.5), frameOf(8.2), frameOf(LAST, 'outro')]) {
        const rec = drawLayer(frame, styleId);
        const long = rec.strokes.filter((s) => s.longest > 12);
        expect(long.length, `${styleId} head ${frame.head}: звеньев нет`).toBeGreaterThan(0);
        for (const s of long) {
          expect(s.dash.length, `${styleId}: сплошной штрих ${s.color} ${s.width}`).toBeGreaterThanOrEqual(2);
          expect(s.dash.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('линия трека стиля (сплошная, толщиной в линию, цвета стиля) не рисуется вовсе', () => {
    const style = STYLES.epic;
    const rec = drawTrack(frameOf(8.2));
    expect(rec.strokes.filter((s) => s.color === style.line.color && s.width >= style.line.width / 2 && s.dash.length === 0)).toEqual([]);
  });

  it('виды участков различаются цветом и штрихом, остаток — след стиля', () => {
    const style = STYLES.epic;
    const rec = drawLayer(frameOf(9.5)); // пройдены унициклы, участки вокруг остановки (unknown) и поезд
    const passed = rec.strokes.filter((s) => s.longest > 12 && s.alpha >= 0.85 && ![style.line.ghost, style.line.casing.color, style.line.ghostCasing].includes(s.color));
    const byColor = new Map(passed.map((s) => [s.color, s]));
    expect(byColor.has(style.line.color)).toBe(false); // Даты закладок не доказывают уницикл.
    expect(byColor.get(style.palette.text)?.dash).toEqual(legLook(style, 'train').dash);
    expect(byColor.get(style.palette.secondary)?.dash).toEqual(legLook(style, 'unknown').dash);
    expect(new Set((['unicycle', 'train', 'unknown'] as const).map((k) => legLook(style, k).dash.join(','))).size).toBe(3);
    expect(rec.strokes.some((s) => s.color === style.line.ghost && s.dash.length >= 2)).toBe(true);
  });

  it('в интро пройденных соединений нет — только след остатка', () => {
    const style = STYLES.epic;
    const rec = drawLayer(frameOf(0, 'intro'));
    expect(rec.strokes.filter((s) => s.longest > 12 && s.color === style.line.color)).toEqual([]);
    expect(rec.strokes.some((s) => s.color === style.line.ghost)).toBe(true);
  });
});

describe('знаки меток — разные (история 141)', () => {
  it('ночёвка — палатка, поезд — значок поезда (на метке и посреди длинного участка), остановка — малая точка без значка', () => {
    drawTrack(frameOf(LAST - 0.5));
    expect(new Set(iconCalls)).toEqual(new Set(['tent', 'train']));
    // ночёвки между стартом и финишем: 1…4, 6, 9…11; жёлтые метки 7, 8 — значок поезда; ещё один значок — посреди длинного участка поезда
    expect(iconCalls.filter((k) => k === 'tent').length).toBe(7);
    expect(iconCalls.filter((k) => k === 'train').length).toBeGreaterThanOrEqual(3);
  });

  it('остановка рисуется точкой меньше ночёвки', () => {
    const style = STYLES.epic;
    const rec = drawLayer(frameOf(LAST - 0.5));
    const overnight = rec.arcs.filter((a) => a.fill === style.line.color).map((a) => a.r);
    const stop = rec.arcs.filter((a) => a.fill === style.palette.text).map((a) => a.r);
    expect(overnight.length).toBeGreaterThan(0);
    expect(Math.min(...stop)).toBeLessThan(Math.min(...overnight));
  });

  it('на общем плане метки плотные: вместо значков — точки (значки не сливаются в комок)', () => {
    drawTrack(frameOf(LAST, 'outro'), 'epic', 4); // 4 px на градус: соседние метки в 2 px
    expect(iconCalls).toEqual([]);
  });
});

describe('голова', () => {
  it('голова рисуется на проекции headLonLat (кольцо головы)', () => {
    const style = STYLES.epic;
    const rec = drawTrack(frameOf(3.5));
    expect(rec.arcs.some((a) => a.fill === style.marker.fill)).toBe(true);
  });
});

// Полный кадр: независимо измеряем блок титра и итогов по нарисованному тексту, включая сдвиг появления.
import { recorder as overlayRecorder } from './overlay-recorder';
import { drawOverlay, fitTitle } from '../../src/render/overlay';
import { layoutFor, timelineOptionsFor, type Rect } from '../../src/render/layout';
import { buildTimeline } from '../../src/story';
import { FPS, type Format, type Lang } from '../../src/types';
import { settings as baseSettings } from '../story/fixtures';
import { beatTitle } from '../../src/i18n';

// Матрица RU/EN × epic/atlas × оба формата разложена на 8 отдельных тестов: подбор места подписей (placeWaypointLabel) на каждом
// кадре — чистый CPU, ~0,7 с на комбинацию. Одним тестом это ~5,5 с в одиночку и упиралось в testTimeout (20 с) при параллельном
// `npm run check` (71 файл делят процессор). Проверяются те же кадры и те же комбинации; таймаут на каждую — свой.
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (a: Rect, b: Rect) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w + 0.01 && b.y + b.h <= a.y + a.h + 0.01;
describe('подписи не пересекают полный титр, итоги, рабочую зону и друг друга на каждом кадре интро/финала', () => {
  for (const format of ['9:16', '16:9'] as Format[]) for (const styleId of ['epic', 'atlas'] as const) for (const lang of ['ru', 'en'] as Lang[]) it(`${format} ${styleId} ${lang}`, () => {
    const title = lang === 'ru' ? 'Путешествие экспедиция' : 'Mountains expedition';
    const settings = baseSettings({ format, styleId, lang, title, author: lang === 'ru' ? 'Автор путешествия' : 'Journey author' });
    const style = STYLES[styleId], layout = layoutFor(format, styleId), view = MAP_VIEWPORT[format];
    // У теста действительно двухстрочный заголовок, а не короткий happy path.
    expect(fitTitle(title, format, styleId, (s, size) => s.length * size * 0.55).lines).toHaveLength(2);
    const tl = buildTimeline(route, enrichment, settings, timelineOptionsFor(format, styleId));
    let titleFrames = 0, summaryFrames = 0, labels = 0;
    for (let i = 0; i <= tl.frameCount; i++) {
      const frame = tl.frameAt(i / FPS);
      if (frame.act === 'journey') continue;
      const overlay = overlayRecorder();
      drawOverlay(overlay.ctx, frame, { route, enrichment, settings, style, reconstruction: false });
      const content = overlay.textRects.filter((r) => !r.text.includes('Community') && !r.text.includes('OpenStreetMap'));
      const titleText = content.filter((r) => title.split(' ').includes(r.text) || r.text === settings.author
        || /маршрут по меткам, не GPS-трек|route from waypoints, not a GPS track/i.test(r.text));
      const obstacles: Rect[] = [...content];
      if (titleText.length) {
        titleFrames++;
        obstacles.push({ x: layout.title.x, y: Math.min(...titleText.map((r) => r.y)), w: layout.title.w,
          h: Math.max(...titleText.map((r) => r.y + r.h)) - Math.min(...titleText.map((r) => r.y)) });
      }
      if (content.some((r) => /ИТОГ ПОЕЗДКИ|TRIP SUMMARY/.test(r.text))) {
        summaryFrames++;
        obstacles.push({ ...layout.summary, y: layout.summary.y - 4, h: layout.summary.h + style.motion.rise + 4 });
      }
      // Камера может прижать оба конца к титру, оговорке, колонке итогов или нижней границе; петля — одинаковые проекции.
      const positions = [
        { x: layout.title.x + 140, y: layout.title.y + 190 },
        { x: layout.title.x + 140, y: layout.title.y + layout.title.h + 68 },
        { x: layout.summary.x + 120, y: layout.summary.y + 120 },
        { x: layout.work.x + layout.work.w - 20, y: layout.work.y + layout.work.h - 12 },
      ];
      for (const pos of positions) {
        const rec = overlayRecorder();
        drawTrackLayer({ ctx: rec.ctx, route, model: prepareTrack(route), enrichment, lang, frame, style, view,
          project: () => ({ x: pos.x / 2, y: pos.y / 2 }) });
        const names = enrichment.beats.filter((b) => b.kind === 'start' || b.kind === 'finish').map((b) => beatTitle(lang, b, { near: true }));
        const labelRects = rec.textRects.filter((r) => names.includes(r.text)).map((r) => {
          const box = rec.fills.find((box) => contains(box, r));
          expect(box, 'подпись должна иметь полную подложку').toBeDefined();
          return { x: box!.x * 2, y: box!.y * 2, w: box!.w * 2, h: box!.h * 2 };
        });
        expect(labelRects).toHaveLength(2);
        labels += labelRects.length;
        for (const box of labelRects) {
          expect(contains(layout.work, box), format + ' ' + styleId + ' ' + lang + ' t=' + frame.t).toBe(true);
          for (const obstacle of obstacles) expect(overlap(box, obstacle), format + ' ' + styleId + ' ' + lang + ' t=' + frame.t + ' label=' + JSON.stringify(box) + ' obstacle=' + JSON.stringify(obstacle)).toBe(false);
        }
        if (labelRects.length === 2) expect(overlap(labelRects[0], labelRects[1])).toBe(false);
      }
    }
    expect(titleFrames).toBeGreaterThan(100);
    expect(summaryFrames).toBeGreaterThan(30);
    expect(labels).toBeGreaterThan(500);
  });
});

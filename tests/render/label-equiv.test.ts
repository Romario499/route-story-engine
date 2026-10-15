// Снимок подбора подписей маршрута по меткам (placeWaypointLabel в drawTrackLayer): хеш всего, что кадр рисует на холсте
// (операции, тексты с точными рамками, заливки, штрихи, labelBoxes) по матрице кадров интро/финала: 2 маршрута × формат × стиль ×
// язык × 10 проекций (в т. ч. линейные, чтобы пунктир пересекал кандидатов) + GPX-фикстура. Пока подпись менять не собирались,
// снимок обязан совпадать с эталоном, снятым ДО ускорения подбора (позиции и набор подписей бит-в-бит).
// Полная поэлементная сверка (5760 кадров, stride 9) делалась вне репозитория: эталон до правки против версии после — 0 расхождений.
// Намеренно меняете подписи — пересчитайте PINNED (значение печатает падающий тест).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/render/assets', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/render/assets')>();
  return { ...original, drawIcon: () => undefined };
});

import { STYLES } from '../../src/render/styles';
import { drawTrackLayer, prepareTrack } from '../../src/render/track';
import { layoutFor, timelineOptionsFor } from '../../src/render/layout';
import { buildTimeline } from '../../src/story';
import { FPS, MAP_VIEWPORT, type Format, type FrameState, type Lang, type Route } from '../../src/types';
import { enrichmentFor, settings as baseSettings } from '../story/fixtures';
import { jw, confirmedWaypointRoute, syntheticJourney } from '../story/waypoint-fixtures';
import { buildRoute, parseRouteText } from '../../src/route';
import trackGpx from '../fixtures/track.gpx?raw';
import { recorder } from './overlay-recorder';

class FakePath2D { moveTo(): void { /* — */ } lineTo(): void { /* — */ } quadraticCurveTo(): void { /* — */ } }
beforeAll(() => { vi.stubGlobal('Path2D', FakePath2D); });
afterAll(() => { vi.unstubAllGlobals(); });

const MARKS = [
  jw(40, 30, 'overnight', 0), jw(40, 30.5, 'overnight', 1), jw(40, 31, 'overnight', 2), jw(40, 31.5, 'overnight', 3),
  jw(40, 32, 'overnight', 4), jw(40.1, 32.2, 'stop', 4), jw(40, 32.7, 'overnight', 5),
  jw(40.5, 34.7, 'train', 6), jw(40.5, 36.7, 'train', 7), jw(40.5, 37.2, 'overnight', 8),
  jw(40.5, 37.7, 'overnight', 9), jw(40.5, 38.2, 'overnight', 10), jw(40.5, 38.7, 'overnight', 11),
];
const gpxRoute = (): Route => {
  const parsed = parseRouteText('track.gpx', trackGpx);
  if (!parsed.ok) throw new Error('track.gpx');
  const built = buildRoute(parsed.tracks);
  if ('error' in built) throw new Error(built.error);
  return built;
};
const ROUTES: [string, Route][] = [['marks13', confirmedWaypointRoute(MARKS)], ['journey66', confirmedWaypointRoute(syntheticJourney())], ['gpx', gpxRoute()]];

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Два FNV-1a (32 бита, разные затравки) по JSON: 16 hex-знаков, без node-модулей (в tsconfig нет типов node). */
function digest(v: unknown): string {
  const str = JSON.stringify(v);
  let h1 = 0x811c9dc5, h2 = 0x9747b28c;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** Кадры интро/финала матрицы: хеш на каждую (маршрут, формат, стиль, язык, кадр, проекция). */
function snapshot(stride: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, route] of ROUTES) {
    const enrichment = enrichmentFor(route, { border: 6 });
    for (const format of ['9:16', '16:9'] as Format[]) for (const styleId of ['epic', 'atlas'] as const) for (const lang of ['ru', 'en'] as Lang[]) {
      const settings = baseSettings({ format, styleId, lang, title: lang === 'ru' ? 'Путешествие экспедиция' : 'Mountains expedition', author: 'A' });
      const style = STYLES[styleId], layout = layoutFor(format, styleId), view = MAP_VIEWPORT[format];
      const tl = buildTimeline(route, enrichment, settings, timelineOptionsFor(format, styleId));
      const rnd = prng(7 + format.length * 131 + lang.length * 17);
      const model = prepareTrack(route);
      const lon0 = route.points.reduce((acc, q) => acc + q.lon, 0) / route.points.length, lat0 = route.points.reduce((acc, q) => acc + q.lat, 0) / route.points.length;
      const projections: [string, (lon: number, lat: number) => { x: number; y: number }][] = [
        ['t0', () => ({ x: (layout.title.x + 140) / 2, y: (layout.title.y + 190) / 2 })],
        ['t1', () => ({ x: (layout.title.x + 140) / 2, y: (layout.title.y + layout.title.h + 68) / 2 })],
        ['s', () => ({ x: (layout.summary.x + 120) / 2, y: (layout.summary.y + 120) / 2 })],
        ['w', () => ({ x: (layout.work.x + layout.work.w - 20) / 2, y: (layout.work.y + layout.work.h - 12) / 2 })],
        ...[0, 1, 2].map((k): [string, (lon: number, lat: number) => { x: number; y: number }] => {
          const px = rnd() * view.width, py = rnd() * view.height;
          return [`r${k}`, () => ({ x: px, y: py })];
        }),
        ...[3, 12, 40].map((scale): [string, (lon: number, lat: number) => { x: number; y: number }] => {
          const cx = rnd() * view.width, cy = rnd() * view.height;
          return [`lin${scale}`, (lon, lat) => ({ x: cx + (lon - lon0) * scale, y: cy - (lat - lat0) * scale })];
        }),
      ];
      for (let i = 0; i <= tl.frameCount; i += stride) {
        const frame: FrameState = tl.frameAt(i / FPS);
        if (frame.act === 'journey') continue;
        for (const [pname, project] of projections) {
          const rec = recorder();
          let result: unknown;
          try {
            drawTrackLayer({ ctx: rec.ctx, route, model, enrichment, lang, frame, style, view, project });
            result = { ops: rec.ops, text: rec.textRects, fills: rec.fills, strokes: rec.strokes, boxes: model.labelBoxes };
          } catch (e) { result = 'THROW ' + (e instanceof Error ? e.message : String(e)); }
          out[`${name} ${format} ${styleId} ${lang} f${i} ${pname}`] = digest(result);
        }
      }
    }
  }
  return out;
}

/** Один хеш на весь снимок: порядок ключей фиксирован обходом матрицы. */
const total = (snap: Record<string, string>) => digest(Object.entries(snap));
/** Снято на реализации ДО ускорения подбора (stride 45). */
const PINNED = '2b592d012b448e22';

describe('подбор подписей меток: результат кадров интро/финала не меняется', () => {
  it('компактный снимок (stride 45) совпадает с эталоном', () => {
    const snap = snapshot(45);
    expect(Object.keys(snap).length).toBeGreaterThan(150);
    expect(total(snap)).toBe(PINNED);
  });
});

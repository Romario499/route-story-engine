// Бесшовная камера (истории 129, G61): между соседними кадрами 30 fps zoom и центр не прыгают ни на примере @wahrier,
// ни на синтетике tests/fixtures/synthetic/ (стоянка с шумом, редкий логгер, разрыв 50 км, город, без времени/высоты);
// перемотка к t даёт тот же кадр, что последовательный проход.
import { describe, expect, it } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { buildRoute, parseRouteText } from '../../src/route';
import { timelineOptionsFor } from '../../src/render/layout';
import { buildTimeline } from '../../src/story';
import { FPS, type Enrichment, type FrameState, type Route } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';
import sampleGpx from '../../public/samples/wahrier-reconstruction.gpx?raw';
import { enrichmentFor, rng, settings } from './fixtures';

/** Предел шага zoom между соседними кадрами (3,6 уровня в секунду) и ускорения (изменения шага между кадрами). */
const MAX_ZOOM_STEP = 0.12;
const MAX_ZOOM_ACCEL = 0.008;
/** Предел шага центра, CSS-пикселей кадра карты за кадр (переезд проходится быстрее своего хода, но камера поднимается; ≈ 1 экран в секунду). */
const MAX_CENTER_STEP_PX = 40;

const geo = createGeoIndex(JSON.parse(countriesRaw) as CountriesJson, JSON.parse(placesRaw) as PlacesJson);
const files = import.meta.glob('../fixtures/synthetic/*.gpx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

interface Case { name: string; route: Route; enr: Enrichment }
function load(name: string, text: string, real: boolean): Case | null {
  const parsed = parseRouteText(name, text);
  if (!parsed.ok) return null;
  const route = buildRoute(parsed.tracks);
  if ('error' in route) return null;
  return { name, route, enr: real ? enrichRoute(route, geo) : enrichmentFor(route) };
}
const cases: Case[] = [
  load('пример @wahrier', sampleGpx, true),
  ...Object.entries(files).map(([path, text]) => load(path.split('/').pop()!, text, false)),
].filter((c): c is Case => c !== null);

const mx = (lon: number) => lon / 360 + 0.5;
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
const all = (tl: { frameCount: number; frameAt(t: number): FrameState }) =>
  Array.from({ length: tl.frameCount + 1 }, (_, i) => tl.frameAt(i / FPS));

describe('бесшовная камера (история 129)', () => {
  it('на примере и синтетике найдено не меньше шести маршрутов', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6);
  });

  for (const c of cases) {
    for (const durationSec of [15, 30, 60] as const) {
      for (const format of ['9:16', '16:9'] as const) {
        it(`${c.name}, ${durationSec} с, ${format}: шаг zoom, ускорение zoom и шаг центра ограничены на всём ролике`, () => {
          const fs = all(buildTimeline(c.route, c.enr, settings({ durationSec, format }), timelineOptionsFor(format)));
          let prevDz = 0;
          for (let i = 1; i < fs.length; i++) {
            const a = fs[i - 1].camera, b = fs[i].camera;
            const dz = Math.abs(b.zoom - a.zoom);
            expect(dz, `кадр ${i}: шаг zoom`).toBeLessThanOrEqual(MAX_ZOOM_STEP);
            expect(Math.abs(dz - prevDz), `кадр ${i}: ускорение zoom`).toBeLessThanOrEqual(MAX_ZOOM_ACCEL);
            prevDz = dz;
            const world = 512 * 2 ** Math.max(a.zoom, b.zoom);
            const px = Math.hypot((mx(b.center[0]) - mx(a.center[0])) * world, (my(b.center[1]) - my(a.center[1])) * world);
            expect(px, `кадр ${i}: шаг центра`).toBeLessThanOrEqual(MAX_CENTER_STEP_PX);
            expect(Math.abs(b.pitch - a.pitch), `кадр ${i}: наклон`).toBeLessThanOrEqual(0.06);
          }
        });
      }
    }

    it(`${c.name}: 20 случайных t дают тот же кадр, что последовательный проход`, () => {
      const rnd = rng(7);
      const ts = Array.from({ length: 20 }, () => rnd() * 30);
      const tlA = buildTimeline(c.route, c.enr, settings({ durationSec: 30 }));
      const random = ts.map((t) => tlA.frameAt(t));
      const tlB = buildTimeline(c.route, c.enr, settings({ durationSec: 30 }));
      const sequential = all(tlB);
      expect(sequential.length).toBeGreaterThan(0);
      ts.forEach((t, k) => expect(tlB.frameAt(t)).toEqual(random[k]));
    });
  }
});

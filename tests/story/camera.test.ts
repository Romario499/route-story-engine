import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import { FPS, MAP_VIEWPORT, type CameraState, type FrameState, type Route } from '../../src/types';
import { buildRoute } from '../../src/route';
import { distM, eastLine, enrichmentFor, lineRoute, ok, settings, track } from './fixtures';

function frames(tl: { frameCount: number; frameAt(t: number): FrameState }): FrameState[] {
  return Array.from({ length: tl.frameCount }, (_, i) => tl.frameAt(i / FPS));
}

// Независимая проекция: Web Mercator, мир = 512·2^z пикселей
const mx = (lon: number) => lon / 360 + 0.5;
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
/** Весь bbox маршрута виден в кадре камеры (CSS-пиксели MAP_VIEWPORT). */
function bboxVisible(route: Route, cam: CameraState, vp: { width: number; height: number }): boolean {
  const world = 512 * 2 ** cam.zoom;
  const [a, b, c, d] = route.bbox;
  const xs = [mx(a), mx(c)].map((x) => (x - mx(cam.center[0])) * world);
  const ys = [my(b), my(d)].map((y) => (y - my(cam.center[1])) * world);
  return xs.every((x) => Math.abs(x) <= vp.width / 2 + 0.5) && ys.every((y) => Math.abs(y) <= vp.height / 2 + 0.5);
}

/** Смещение точки [lon, lat] от центра кадра камеры, CSS-пиксели. */
function offsetPx(cam: CameraState, p: [number, number]): number {
  const world = 512 * 2 ** cam.zoom;
  return Math.hypot((mx(p[0]) - mx(cam.center[0])) * world, (my(p[1]) - my(cam.center[1])) * world);
}
const headOffsetPx = (f: FrameState) => offsetPx(f.camera, f.headLonLat);

describe('камера', () => {
  it('центр сглажен: на треке с GPS-шумом ±30 м шаг центра между кадрами без скачков > 3× среднего', () => {
    // ~10 км на восток с шагом ~6,7 м и шумом ±30 м по обеим осям
    const route = lineRoute(1500, { stepDeg: 0.00008, noiseM: 30, seed: 7 });
    const fs = frames(buildTimeline(route, enrichmentFor(route), settings({ durationSec: 30 })));
    // только пока голова едет: спуск к старту идёт, пока она стоит, а отъезд в финал начинается с её приходом на финиш
    const journey = fs.filter((f) => f.act === 'journey' && f.head > 0 && f.head < route.points.length - 1);
    const steps = journey.slice(1).map((f, i) => distM(journey[i].camera.center, f.camera.center));
    const mean = steps.reduce((s, x) => s + x, 0) / steps.length;
    expect(mean).toBeGreaterThan(0);
    expect(Math.max(...steps)).toBeLessThanOrEqual(3 * mean);
    // поперёк движения (север–юг) шум гасится: «голова» гуляет на десятки метров, камера — на единицы
    const lateralM = (p: [number, number]) => Math.abs(p[1] - 41) * 111_195;
    const inner = journey.filter((f) => f.head > 200 && f.head < 1300);
    const headLat = Math.max(...inner.map((f) => lateralM(f.headLonLat)));
    expect(headLat).toBeGreaterThan(20);
    expect(Math.max(...inner.map((f) => lateralM(f.camera.center)))).toBeLessThan(headLat / 3);
  });

  it('камера чуть впереди «головы» по направлению движения', () => {
    const route = lineRoute(1000); // на восток
    const fs = frames(buildTimeline(route, enrichmentFor(route, { beats: [{ kind: 'start', idx: 0 }, { kind: 'finish', idx: 999 }] }), settings()));
    const mid = fs.filter((f) => f.act === 'journey' && f.head > 300 && f.head < 700);
    expect(mid.length).toBeGreaterThan(0);
    const vp = MAP_VIEWPORT['9:16'];
    for (const f of mid) {
      expect(f.camera.center[0]).toBeGreaterThan(f.headLonLat[0]);
      // «чуть»: голова не дальше 0,3 ширины кадра от центра
      expect(headOffsetPx(f)).toBeLessThanOrEqual(0.3 * vp.width);
    }
  });

  it('зум путешествия зависит от размаха: 10-км трек ближе, чем 3000-км', () => {
    const small = lineRoute(1200, { stepDeg: 0.0001 }); // ~10 км
    const big = lineRoute(3000, { stepDeg: 0.012 });    // ~3000 км
    const zoomOf = (route: Route) => {
      const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: 30 }));
      return { overview: tl.frameAt(0).camera.zoom, journey: tl.frameAt(15).camera.zoom };
    };
    const s = zoomOf(small), b = zoomOf(big);
    expect(s.journey).toBeGreaterThan(b.journey + 4);
    expect(s.journey).toBeGreaterThan(s.overview + 0.4);
    expect(b.journey).toBeGreaterThan(b.overview + 0.4);
    // не улица и не вся страна: в кадре 9:16 по ширине — от ~1 км до ~1000 км
    for (const [route, z] of [[small, s.journey], [big, b.journey]] as const) {
      const lat = (route.bbox[1] + route.bbox[3]) / 2;
      const widthM = (MAP_VIEWPORT['9:16'].width / (512 * 2 ** z)) * 40_075_016.686 * Math.cos((lat * Math.PI) / 180);
      expect(widthM).toBeGreaterThan(1000);
      expect(widthM).toBeLessThan(1_000_000);
      expect(widthM).toBeLessThan(0.7 * route.totalM);
    }
  });

  for (const format of ['9:16', '16:9'] as const) {
    it(`${format}: интро начинается и финал заканчивается общим планом всего маршрута`, () => {
      const route = lineRoute(2000, { stepDeg: 0.005 });
      const tl = buildTimeline(route, enrichmentFor(route), settings({ format, durationSec: 15 }));
      const first = tl.frameAt(0).camera;
      const last = tl.frameAt(15).camera;
      const vp = MAP_VIEWPORT[format];
      expect(bboxVisible(route, first, vp)).toBe(true);
      expect(bboxVisible(route, last, vp)).toBe(true);
      expect(Math.abs(first.zoom - last.zoom)).toBeLessThan(0.3);
      expect(first.pitch).toBe(0);
      expect(last.pitch).toBe(0);
      expect(first.bearing).toBe(0);
      const mid = tl.frameAt(7.5).camera;
      expect(mid.pitch).toBe(1);
      expect(mid.bearing).toBe(0);
      expect(bboxVisible(route, mid, vp)).toBe(false);
    });
  }

  it('без рывков: зум и центр (в пикселях кадра) меняются плавно на всём ролике', () => {
    const route = lineRoute(2000, { stepDeg: 0.005 });
    const fs = frames(buildTimeline(route, enrichmentFor(route), settings({ durationSec: 15 })));
    for (let i = 1; i < fs.length; i++) {
      const a = fs[i - 1].camera, b = fs[i].camera;
      expect(Math.abs(b.zoom - a.zoom)).toBeLessThan(0.2);
      const world = 512 * 2 ** Math.max(a.zoom, b.zoom);
      const px = Math.hypot((mx(b.center[0]) - mx(a.center[0])) * world, (my(b.center[1]) - my(a.center[1])) * world);
      expect(px).toBeLessThan(60);
    }
  });

  for (const format of ['9:16', '16:9'] as const) {
    it(`${format}, ~5 000 км за 15 с: голова всё путешествие и старт к концу спуска — в пределах 0,3 кадра от центра, а в конце интро — в кадре`, () => {
      // 60° долготы по 41° с. ш. ≈ 5 000 км, с плавными изгибами
      const pts = eastLine(3000, { stepDeg: 0.02, lon0: 20 }).map((p, i) => ({ ...p, lat: p.lat + 1.5 * Math.sin(i / 120) }));
      const route = ok(buildRoute([track('a.gpx', [pts])]));
      const tl = buildTimeline(route, enrichmentFor(route), settings({ format, durationSec: 15 }));
      const fs = frames(tl);
      const limit = 0.3 * Math.min(MAP_VIEWPORT[format].width, MAP_VIEWPORT[format].height);
      const journey = fs.filter((f) => f.act === 'journey' && f.head > 0 && f.head < route.points.length - 1);
      const worst = Math.max(...journey.map(headOffsetPx));
      expect(worst).toBeLessThanOrEqual(limit);
      // спуск кончается ровно тогда, когда голова трогается: старт уже у центра
      const start: [number, number] = [route.points[0].lon, route.points[0].lat];
      expect(offsetPx(journey[0].camera, start)).toBeLessThanOrEqual(limit);
      // а к концу интро камера ещё спускается, но старт из кадра не уходит
      const vp = MAP_VIEWPORT[format];
      const introLast = fs.filter((f) => f.act === 'intro').pop()!;
      const world = 512 * 2 ** introLast.camera.zoom;
      const dx = (mx(start[0]) - mx(introLast.camera.center[0])) * world;
      const dy = (my(start[1]) - my(introLast.camera.center[1])) * world;
      expect(Math.abs(dx)).toBeLessThanOrEqual(vp.width / 2);
      expect(Math.abs(dy)).toBeLessThanOrEqual(vp.height / 2);
    });
  }

  it('общий план оставляет место под карточку: при отступе снизу 40% высоты маршрут в верхних 60% кадра', () => {
    // маршрут с заметной высотой bbox: 10° по долготе, ±4° по широте
    const pts = eastLine(2000, { stepDeg: 0.005 }).map((p, i) => ({ ...p, lat: p.lat + 4 * Math.sin(i / 300) }));
    const route = ok(buildRoute([track('a.gpx', [pts])]));
    const vp = MAP_VIEWPORT['9:16'];
    const pad = { top: 30, right: 30, bottom: 0.4 * vp.height, left: 30 };
    const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: 15 }), { overviewPadding: pad });
    for (const cam of [tl.frameAt(0).camera, tl.frameAt(15).camera]) {
      const world = 512 * 2 ** cam.zoom;
      const [a, b, c, d] = route.bbox;
      for (const [lon, lat] of [[a, b], [a, d], [c, b], [c, d]]) {
        const sx = vp.width / 2 + (mx(lon) - mx(cam.center[0])) * world;
        const sy = vp.height / 2 + (my(lat) - my(cam.center[1])) * world;
        expect(sx).toBeGreaterThanOrEqual(pad.left - 0.5);
        expect(sx).toBeLessThanOrEqual(vp.width - pad.right + 0.5);
        expect(sy).toBeGreaterThanOrEqual(pad.top - 0.5);
        expect(sy).toBeLessThanOrEqual(0.6 * vp.height + 0.5);
      }
    }
    // по умолчанию — прежний симметричный общий план
    const def = buildTimeline(route, enrichmentFor(route), settings({ durationSec: 15 })).frameAt(0).camera;
    expect(bboxVisible(route, def, vp)).toBe(true);
  });
  /** Скорость центра камеры, px/кадр (в пикселях большего из двух зумов). */
  const centerSpeeds = (fs: FrameState[]) => fs.slice(1).map((f, i) => {
    const a = fs[i].camera, b = f.camera;
    const world = 512 * 2 ** Math.max(a.zoom, b.zoom);
    return Math.hypot((mx(b.center[0]) - mx(a.center[0])) * world, (my(b.center[1]) - my(a.center[1])) * world);
  });

  it('переезд: на входе и выходе скорость камеры меняется плавно (≤ 3 px/кадр между соседними кадрами)', () => {
    // 25 км своим ходом, разрыв ~25 км (граница файлов = переезд), ещё 25 км
    const a = eastLine(300, { lon0: 40 });
    const b = eastLine(300, { lon0: 40 + 0.299 + 0.3 });
    const route = ok(buildRoute([track('a.gpx', [a]), track('b.gpx', [b])]));
    expect(route.transfers).toHaveLength(1);
    const { fromIdx, toIdx } = route.transfers[0];
    const enr = enrichmentFor(route, { beats: [{ kind: 'start', idx: 0 }, { kind: 'finish', idx: route.points.length - 1 }] });
    for (const durationSec of [15, 30] as const) {
      const fs = frames(buildTimeline(route, enr, settings({ durationSec })));
      const v = centerSpeeds(fs);
      // окно вокруг переезда: от 1 с до входа до 1 с после выхода
      const enter = fs.findIndex((f) => f.head > fromIdx);
      const exit = fs.findIndex((f) => f.head >= toIdx);
      expect(enter).toBeGreaterThan(0);
      for (let i = Math.max(1, enter - FPS); i < Math.min(v.length, exit + FPS); i++) {
        expect(Math.abs(v[i] - v[i - 1]), `кадр ${i}, ${durationSec} с`).toBeLessThanOrEqual(3);
      }
      // а сам переезд всё равно проходится быстрее своего хода
      expect(Math.max(...v.slice(enter, exit))).toBeGreaterThan(1.5 * v[Math.floor(enter / 2)]);
    }
  });

  it('стык интро → путешествие и путешествие → финал: скорость камеры меняется плавно (≤ 3 px/кадр)', () => {
    const pts = eastLine(3000, { stepDeg: 0.02, lon0: 20 }).map((p, i) => ({ ...p, lat: p.lat + 1.5 * Math.sin(i / 120) }));
    const route = ok(buildRoute([track('a.gpx', [pts])]));
    for (const format of ['9:16', '16:9'] as const) {
      const fs = frames(buildTimeline(route, enrichmentFor(route), settings({ format, durationSec: 15 })));
      const v = centerSpeeds(fs);
      const seams = [fs.findIndex((f) => f.act === 'journey'), fs.findIndex((f) => f.act === 'outro')];
      for (const seam of seams) {
        // ±0,5 с вокруг стыка: конец нырка/начало отъезда и первые кадры соседнего акта
        for (let i = Math.max(1, seam - FPS / 2); i < Math.min(v.length, seam + FPS / 2); i++) {
          expect(Math.abs(v[i] - v[i - 1]), `${format}, кадр ${i}`).toBeLessThanOrEqual(3);
        }
      }
    }
  });
});

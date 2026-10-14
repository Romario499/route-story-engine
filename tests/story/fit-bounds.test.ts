import { describe, expect, it } from 'vitest';
import { fitBounds } from '../../src/story';
import { MAP_VIEWPORT } from '../../src/types';

// Независимая от кода под тестом проекция: Web Mercator, мир = 512·2^z пикселей
const mx = (lon: number) => lon / 360 + 0.5;
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
/** Размер bbox в пикселях на зуме z и смещение центра bbox от центра кадра. */
function projected(bbox: [number, number, number, number], center: [number, number], zoom: number) {
  const world = 512 * 2 ** zoom;
  const w = (mx(bbox[2]) - mx(bbox[0])) * world;
  const h = (my(bbox[1]) - my(bbox[3])) * world;
  const cx = ((mx(bbox[0]) + mx(bbox[2])) / 2 - mx(center[0])) * world;
  const cy = ((my(bbox[1]) + my(bbox[3])) / 2 - my(center[1])) * world;
  return { w, h, cx, cy };
}

describe('fitBounds — Меркатор, тайл 512', () => {
  it('весь мир в 512×512 без отступа — зум 0, центр 0,0; в 1024×1024 — зум 1', () => {
    const world: [number, number, number, number] = [-180, -85.051129, 180, 85.051129];
    const a = fitBounds(world, { width: 512, height: 512 }, 0);
    expect(a.zoom).toBeCloseTo(0, 3);
    expect(a.center[0]).toBeCloseTo(0, 6);
    expect(a.center[1]).toBeCloseTo(0, 6);
    expect(fitBounds(world, { width: 1024, height: 1024 }, 0).zoom).toBeCloseTo(1, 3);
  });

  const cases: [string, [number, number, number, number]][] = [
    ['Турция–Китай', [39.7, 36.5, 80.4, 45.3]],
    ['10-км трек', [44.78, 41.69, 44.9, 41.72]], // ~10 км по долготе на 41.7° с. ш.
  ];
  for (const [name, bbox] of cases) {
    it(`${name}: bbox помещается в 9:16 с отступом и упирается в него по одной стороне`, () => {
      const vp = MAP_VIEWPORT['9:16'];
      const pad = 40;
      const { center, zoom } = fitBounds(bbox, vp, pad);
      const p = projected(bbox, center, zoom);
      expect(p.w).toBeLessThanOrEqual(vp.width - 2 * pad + 0.5);
      expect(p.h).toBeLessThanOrEqual(vp.height - 2 * pad + 0.5);
      // плотно: по ограничивающей стороне занято всё место за вычетом отступов
      const fill = Math.max(p.w / (vp.width - 2 * pad), p.h / (vp.height - 2 * pad));
      expect(fill).toBeGreaterThan(0.99);
      // bbox по центру кадра
      expect(Math.abs(p.cx)).toBeLessThan(0.5);
      expect(Math.abs(p.cy)).toBeLessThan(0.5);
    });
  }

  it('маленький трек получает зум больше, чем трансконтинентальный', () => {
    const vp = MAP_VIEWPORT['9:16'];
    const big = fitBounds(cases[0][1], vp, 40).zoom;
    const small = fitBounds(cases[1][1], vp, 40).zoom;
    expect(big).toBeGreaterThan(2);
    expect(big).toBeLessThan(5);
    expect(small).toBeGreaterThan(11);
    expect(small).toBeLessThan(14);
  });

  it('вырожденный bbox (одна точка) — конечный зум и центр в точке', () => {
    const r = fitBounds([44.8, 41.7, 44.8, 41.7], MAP_VIEWPORT['16:9'], 40);
    expect(Number.isFinite(r.zoom)).toBe(true);
    expect(r.center[0]).toBeCloseTo(44.8, 6);
    expect(r.center[1]).toBeCloseTo(41.7, 6);
  });

  it('несимметричный отступ: bbox помещается в окно за вычетом отступов и стоит по его центру', () => {
    const vp = MAP_VIEWPORT['9:16'];
    const bbox = cases[0][1];
    const pad = { top: 40, right: 20, bottom: 384, left: 60 };
    const { center, zoom } = fitBounds(bbox, vp, pad);
    const p = projected(bbox, center, zoom);
    const availW = vp.width - pad.left - pad.right, availH = vp.height - pad.top - pad.bottom;
    expect(p.w).toBeLessThanOrEqual(availW + 0.5);
    expect(p.h).toBeLessThanOrEqual(availH + 0.5);
    expect(Math.max(p.w / availW, p.h / availH)).toBeGreaterThan(0.99);
    // центр bbox на экране = центр окна: смещение от центра кадра ((l − r)/2, (t − b)/2)
    expect(p.cx).toBeCloseTo((pad.left - pad.right) / 2, 0);
    expect(p.cy).toBeCloseTo((pad.top - pad.bottom) / 2, 0);
  });
});

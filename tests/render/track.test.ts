import { describe, expect, it } from 'vitest';
import { displayIndexAtHead, prepareTrack, visibleDisplay } from '../../src/render/track';
import type { Route, RoutePoint } from '../../src/types';

/** Маршрут вручную: 6 точек по параллели, переезд перед точкой 3, отрисовывается 0, 2, 4, 5. */
function handRoute(): Route {
  const points: RoutePoint[] = Array.from({ length: 6 }, (_, i) => ({
    lat: 41, lon: 40 + i * 0.1, d: i * 8000, seg: 0, transferBefore: i === 3,
  }));
  return {
    points, display: [0, 2, 4, 5], totalM: 40000, ownM: 32000,
    transfers: [{ fromIdx: 2, toIdx: 3 }], hasTime: false, hasEle: false,
    bbox: [40, 41, 40.5, 41], waypoints: [],
  };
}

describe('prepareTrack', () => {
  it('сегмент дисплейной линии помечен переездом, только если через него идёт переезд', () => {
    const m = prepareTrack(handRoute());
    expect(m.n).toBe(4);
    expect(Array.from(m.idx)).toEqual([0, 2, 4, 5]);
    // сегменты: 0→2 (нет), 2→4 (переезд перед точкой 3), 4→5 (нет)
    expect(Array.from(m.transferSeg)).toEqual([0, 1, 0]);
  });

  it('координаты Меркатора растут вместе с долготой и падают с широтой (север — вверх)', () => {
    const m = prepareTrack(handRoute());
    expect(m.mx[1]).toBeGreaterThan(m.mx[0]);
    expect(m.mx[0]).toBeCloseTo(40 / 360 + 0.5, 12);
    expect(m.my[0]).toBeCloseTo(0.5 - Math.log(Math.tan(Math.PI / 4 + (41 * Math.PI) / 360)) / (2 * Math.PI), 10);
  });
});

describe('displayIndexAtHead', () => {
  const m = prepareTrack(handRoute());
  it.each([
    [0, 0], [1.9, 0], [2, 1], [3.5, 1], [4, 2], [4.99, 2], [5, 3], [99, 3], [-1, 0],
  ])('голова %f → последняя дисплейная точка %i', (head, k) => {
    expect(displayIndexAtHead(m, head)).toBe(k);
  });
});

describe('visibleDisplay', () => {
  const m = prepareTrack(handRoute());
  it('помечает точки в радиусе и по одному соседу с каждой стороны', () => {
    // радиус вокруг точки display[2] (lon 40.4) — только она сама
    const r = 0.00001;
    const keep = visibleDisplay(m, m.mx[2], m.my[2], r);
    expect(Array.from(keep)).toEqual([0, 1, 1, 1]);
  });
  it('пустой круг — ничего', () => {
    const keep = visibleDisplay(m, 0.1, 0.1, 0.001);
    expect(Array.from(keep)).toEqual([0, 0, 0, 0]);
  });
  it('большой круг — всё', () => {
    const keep = visibleDisplay(m, m.mx[1], m.my[1], 1);
    expect(Array.from(keep)).toEqual([1, 1, 1, 1]);
  });
});

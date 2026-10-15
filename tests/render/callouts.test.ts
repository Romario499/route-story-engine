import { expect, it } from 'vitest';
import { placeCallout } from '../../src/render/callouts';
import { waypointLineIntersects } from '../../src/render/waypoint-layer';

it('карточка обходит собственный флаг, а линия выноски может выйти из него', () => {
  const flag = { x: 166, y: 114, w: 56, h: 80 };
  const bounds = { x: 10, y: 10, w: 380, h: 380 }, anchor = { x: 180, y: 180 };
  expect(placeCallout(anchor, bounds, 140, 80, [flag], [])).toBeNull(); // обычную плашку пересекать нельзя
  const box = placeCallout(anchor, bounds, 140, 80, [flag], [], [flag]);
  expect(box).not.toBeNull();
  expect(box!.x < flag.x + flag.w && box!.x + box!.w > flag.x &&
    box!.y < flag.y + flag.h && box!.y + box!.h > flag.y).toBe(false);
});

it('линия-выноска не пересекает маршрут или плашку на пути к свободному прямоугольнику', () => {
  const anchor = { x: 180, y: 180 };
  const barrier: [number, number, number, number] = [210, 0, 210, 400];
  const obstacle = { x: 40, y: 210, w: 140, h: 25 };
  const box = placeCallout(anchor, { x: 10, y: 10, w: 380, h: 380 }, 140, 80, [obstacle], [barrier]);
  expect(box).not.toBeNull();
  const x = Math.max(box!.x, Math.min(box!.x + box!.w, anchor.x));
  const y = Math.max(box!.y, Math.min(box!.y + box!.h, anchor.y));
  expect(x).toBeLessThan(210);
  expect(waypointLineIntersects([anchor.x, anchor.y, x, y], obstacle, 1)).toBe(false);
  expect(placeCallout({ x: 100, y: 180 }, { x: 10, y: 10, w: 380, h: 380 }, 180, 80,
    [], [[160, 0, 160, 400]])).toBeNull(); // свободное место есть только за непрерывной линией
});

it('выноска выбирает свободную сторону, соблюдает safe title и не закрывает записанную линию', () => {
  const line: [number, number, number, number] = [160, 0, 160, 400];
  const box = placeCallout({ x: 100, y: 200 }, { x: 10, y: 10, w: 380, h: 380 }, 120, 60,
    [{ x: 10, y: 10, w: 380, h: 90 }], [line]);
  expect(box).not.toBeNull();
  expect(waypointLineIntersects(line, box!, 8)).toBe(false);
  expect(box!.y).toBeGreaterThanOrEqual(100);
  expect(box!.x + box!.w).toBeLessThanOrEqual(390);
  expect(placeCallout({ x: 50, y: 50 }, { x: 0, y: 0, w: 100, h: 100 }, 120, 60, [], [])).toBeNull();
});

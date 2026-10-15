import { expect, it } from 'vitest';
import { placeCallout } from '../../src/render/callouts';
import { waypointLineIntersects } from '../../src/render/waypoint-layer';

it('финальная карточка остаётся у якоря, даже если только вдали есть место без точек', () => {
  const anchor = { x: 750, y: 750 }, bounds = { x: 0, y: 0, w: 1500, h: 1500 };
  const marks = [{ x: 500, y: 500, w: 500, h: 500 }];
  const flag = { x: 736, y: 684, w: 56, h: 80 };
  const avoid = [{ x: 300, y: 400, w: 0, h: 0 }, { x: 400, y: 480, w: 200, h: 60 }];
  const far = placeCallout(anchor, bounds, 200, 100, [flag], [], [flag], marks, { radius: Infinity, avoid });
  const box = placeCallout(anchor, bounds, 200, 100, [flag], [], [flag], marks, { radius: 250, avoid });
  const distance = (r: NonNullable<typeof box>) => Math.hypot(r.x + r.w / 2 - anchor.x, r.y + r.h / 2 - anchor.y);
  expect(far).not.toBeNull();
  expect(distance(far!)).toBeGreaterThan(250);
  expect(box).not.toBeNull();
  expect(distance(box!)).toBeLessThanOrEqual(250);
  expect(box!.x < flag.x + flag.w && box!.x + box!.w > flag.x &&
    box!.y < flag.y + flag.h && box!.y + box!.h > flag.y).toBe(false);
});

it('возвращает null, если в радиусе нет места или карточка ближе к старту', () => {
  const bounds = { x: 0, y: 0, w: 400, h: 400 }, anchor = { x: 200, y: 200 };
  expect(placeCallout(anchor, bounds, 100, 80, [bounds], [], [], [], { radius: 200, avoid: [] })).toBeNull();
  expect(placeCallout(anchor, bounds, 100, 80, [], [], [], [], { radius: 200, avoid: [bounds] })).toBeNull();
  expect(placeCallout(anchor, bounds, 100, 80, [], [], [], [], { radius: 1, avoid: [] })).not.toBeNull();
});

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
  const across = placeCallout({ x: 100, y: 180 }, { x: 10, y: 10, w: 380, h: 380 }, 180, 80,
    [], [[160, 0, 160, 400]]);
  expect(across).toBeNull(); // GPS и journey сохраняют запрет пересечений master.
});

it('при отсутствии свободной позиции минимизирует закрытую площадь точек, а не расстояние до якоря', () => {
  const bounds = { x: 0, y: 0, w: 300, h: 100 };
  const marks = [{ x: 0, y: 0, w: 120, h: 100 }, { x: 120, y: 0, w: 180, h: 10 }];
  const proximity = { radius: 250, avoid: [] };
  const box = placeCallout({ x: 0, y: 50 }, bounds, 100, 100, [], [], [], marks, proximity);
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(126); // только узкая полоса вместо большой ближайшей точки
  const flag = { x: 200, y: 0, w: 100, h: 100 };
  const protectedBox = placeCallout({ x: 0, y: 50 }, bounds, 100, 100, [flag], [], [], marks, proximity);
  expect(protectedBox).not.toBeNull();
  expect(protectedBox!.x + protectedBox!.w + 6).toBeLessThanOrEqual(flag.x);
});

it('при отсутствии свободной позиции минимизирует длину закрытой линии независимо от числа её вершин', () => {
  const bounds = { x: 0, y: 0, w: 300, h: 100 };
  const segments: [number, number, number, number][] = [[0, 50, 120, 50], [0, 70, 120, 70], [120, 0, 300, 0]];
  const proximity = { radius: 250, avoid: [] };
  const box = placeCallout({ x: 0, y: 50 }, bounds, 100, 100, [], segments, [], [], proximity);
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(126);
  expect(placeCallout({ x: 0, y: 50 }, bounds, 100, 100, [],
    [[0, 50, 60, 50], [60, 50, 120, 50], [0, 70, 120, 70], [120, 0, 210, 0], [210, 0, 300, 0]], [], [], proximity)).toEqual(box);
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

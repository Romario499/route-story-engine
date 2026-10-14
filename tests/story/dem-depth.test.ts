import { expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import { timelineOptionsFor } from '../../src/render/layout';
import { enrichmentFor, lineRoute, settings } from './fixtures';

it('DEM: рельеф/линия/точка/контекст имеют разные физические наклоны и масштабы', () => {
  const route = lineRoute(500, { stepDeg: 0.0002, ele: i => 800 + i * 2 });
  const tl = buildTimeline(route, enrichmentFor(route), settings(), timelineOptionsFor('9:16'));
  const [relief, line, point, context] = [6, 11, 17, 22].map(t => tl.frameAt(t).camera);
  expect(relief.pitch * 74).toBeGreaterThanOrEqual(64);
  expect(relief.pitch * 74).toBeLessThanOrEqual(74);
  expect(line.pitch * 74).toBeGreaterThanOrEqual(58);
  expect(point.pitch * 74).toBeLessThanOrEqual(56);
  expect(context.pitch * 74).toBeLessThanOrEqual(58);
  expect(point.zoom - relief.zoom).toBeGreaterThan(0.7);
  expect(Math.abs(line.bearing - relief.bearing)).toBeGreaterThan(20);
});

import { expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import { timelineOptionsFor } from '../../src/render/layout';
import { enrichmentFor, lineRoute, settings } from './fixtures';

it.each([15, 30, 45, 60] as const)('approach moves inside the %s-second prologue', durationSec => {
  const route = lineRoute(500, { stepDeg: 0.002 });
  const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec }), timelineOptionsFor('9:16'));
  const a = tl.frameAt(0), b = tl.frameAt(1.95 * durationSec / 15);
  expect(b.shot?.kind).toBe('prologue');
  expect(b.camera.zoom - a.camera.zoom).toBeGreaterThan(0.1);
  expect(b.camera.center).not.toEqual(a.camera.center);
});

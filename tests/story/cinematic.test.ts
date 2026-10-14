import { expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import { timelineOptionsFor } from '../../src/render/layout';
import { enrichmentFor, lineRoute, settings } from './fixtures';

it('V5: шесть сцен масштабируются от 15 секунд, камера поворачивается и возвращается к общему плану', () => {
  const route = lineRoute(500, { stepDeg: 0.002, ele: i => 100 + i * 2 });
  for (const durationSec of [15, 30, 45, 60] as const) {
    const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec }), timelineOptionsFor('9:16'));
    const frames = [1, 3, 5, 8, 11, 14].map(s => tl.frameAt(s * durationSec / 15));
    expect(frames.map(f => f.shot?.kind)).toEqual(['prologue', 'relief', 'line', 'point', 'context', 'finale']);
    expect(Math.abs(frames[2].camera.bearing)).toBeGreaterThan(1);
    expect(tl.frameAt(durationSec).camera.pitch).toBe(0);
    expect(tl.frameAt(durationSec).camera.bearing).toBe(0);
    const saved = tl.frameAt(durationSec * 0.6);
    tl.frameAt(0);
    expect(tl.frameAt(durationSec * 0.6)).toEqual(saved);
  }
});

it('планы DEM не пересекают границу z14, где MapLibre 4.7.1 циклически перегружает родителя', () => {
  expect(timelineOptionsFor('9:16', 'epic').maxJourneyZoom).toBe(13.9);
  expect(timelineOptionsFor('16:9', 'atlas').maxJourneyZoom).toBe(13.9);
  const route = lineRoute(500, { stepDeg: 0.0002, ele: i => 100 + 3 * i });
  for (const format of ['9:16', '16:9'] as const) {
    const tl = buildTimeline(route, enrichmentFor(route), settings({ format }), timelineOptionsFor(format));
    for (const second of [8, 12, 16, 18, 20]) expect(tl.frameAt(second).camera.zoom).toBeLessThanOrEqual(13.9);
  }
});

import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import type { FrameState } from '../../src/types';
import { actFill, actSegmentsOf, seekTimeFor } from '../../src/ui/studio/acts';
import { enrichmentFor, lineRoute, settings } from '../story/fixtures';

const fake = (durationSec: number, introEnd: number, journeyEnd: number) => ({
  durationSec, frameCount: durationSec * 30,
  frameAt: (t: number) => ({ t, act: t < introEnd ? 'intro' : t < journeyEnd ? 'journey' : 'outro' }) as FrameState,
});

describe('полоса актов — границы берутся из настоящего Timeline', () => {
  it('30 с: вступление 0–3, путь 3–26, финал 26–30 (таблица ТЗ §7)', () => {
    const route = lineRoute(500);
    const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: 30 }));
    const segs = actSegmentsOf(tl);
    expect(segs.map((s) => s.id)).toEqual(['intro', 'journey', 'outro']);
    expect(segs.map((s) => [s.start, s.end])).toEqual([[0, 3], [3, 26], [26, 30]]);
  });

  it('15 и 60 с — по своим таблицам', () => {
    for (const [d, i, j] of [[15, 2.5, 12], [60, 5, 54]] as const) {
      const route = lineRoute(500);
      const segs = actSegmentsOf(buildTimeline(route, enrichmentFor(route), settings({ durationSec: d })));
      expect(segs.map((s) => [s.start, s.end])).toEqual([[0, i], [i, j], [j, d]]);
    }
  });

  it('акт без длительности не показывается', () => {
    expect(actSegmentsOf(fake(10, 0, 8)).map((s) => s.id)).toEqual(['journey', 'outro']);
  });

  it('клик по акту — время его начала; заливка акта по t', () => {
    const segs = actSegmentsOf(fake(30, 3, 26));
    expect(seekTimeFor(segs, 'journey')).toBe(3);
    expect(actFill(segs[0], 1.5)).toBeCloseTo(0.5, 5);
    expect(actFill(segs[1], 1)).toBe(0);
    expect(actFill(segs[1], 40)).toBe(1);
  });
});

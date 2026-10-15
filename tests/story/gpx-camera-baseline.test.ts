import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import { timelineOptionsFor } from '../../src/render/layout';
import { enrichmentFor, lineRoute, settings, T0 } from './fixtures';

// Эталон снят до изменения камеры меток: все поля каждого кадра, включая титры и итог.
for (const format of ['9:16', '16:9'] as const) {
  for (const cinematic of [false, true]) {
    for (const timed of [false, true]) {
      it(`GPX baseline: ${format}, cinematic=${cinematic}, time=${timed}`, () => {
        const route = lineRoute(120, { stepDeg: 0.04, ...(timed ? { t0: T0, ele: i => 100 + i * 2 } : {}) });
        const timeline = buildTimeline(route, enrichmentFor(route), settings({ format, durationSec: 60 }),
          cinematic ? timelineOptionsFor(format, 'epic') : {});
        const frames = Array.from({ length: 1801 }, (_, i) => timeline.frameAt(i / 30));
        expect(createHash('sha256').update(new TextEncoder().encode(JSON.stringify(frames))).digest('hex')).toMatchSnapshot();
      });
    }
  }
}

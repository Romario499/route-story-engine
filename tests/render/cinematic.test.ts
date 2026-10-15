import { expect, it, vi } from 'vitest';
import { STYLES } from '../../src/render/styles';
import * as callouts from '../../src/render/callouts';
import { drawCinematicGeography } from '../../src/render/cinematic';
import { layoutFor, timelineOptionsFor } from '../../src/render/layout';
import { overlayTitleBottom } from '../../src/render/overlay';
import { prepareTrack } from '../../src/render/track';
import { buildTimeline } from '../../src/story';
import { enrichmentFor, lineRoute, settings } from '../story/fixtures';
import { recorder } from './overlay-recorder';

it('диорама: Expedition содержит реальную векторную географию, DEM и высокий наклон; Atlas тоже включает DEM', () => {
  expect(STYLES.epic.pitch).toBeGreaterThanOrEqual(60);
  expect(STYLES.epic.line.color).toBe('#FF6654');
  expect(STYLES.epic.mapStyle.sources.ofm).toMatchObject({ type: 'vector' });
  expect(STYLES.epic.mapStyle.layers.some(l => l.type === 'line' && l.source === 'ofm' && l['source-layer'] === 'transportation')).toBe(true);
  expect(STYLES.atlas.mapStyle.terrain).toMatchObject({ source: 'dem' });
  expect(STYLES.atlas.terrain?.exaggeration).toBeGreaterThan(1);
  expect(STYLES.neon.terrain).toBeUndefined();
});

it.each(['9:16', '16:9'] as const)('%s: intro трека без глав резервирует легенду на всю рабочую ширину, как master', format => {
  const route = lineRoute(20), enrichment = enrichmentFor(route);
  const cfg = settings({ format }), style = STYLES.epic, l = layoutFor(format, style.id);
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(1);
  expect(route.chapters).toBeUndefined();
  expect(frame.act).toBe('intro');
  expect(frame.shot).toBeDefined();
  const { ctx } = recorder();
  const legendTop = overlayTitleBottom(ctx, frame,
    { route, enrichment, settings: cfg, style, reconstruction: false }) + 46 - l.readability.legendSize - 4;
  const place = vi.spyOn(callouts, 'placeCallout').mockReturnValue(null);
  try {
    drawCinematicGeography(ctx, frame, route, enrichment, cfg, style,
      () => ({ x: (l.work.x + l.work.w / 2) / 2, y: (l.work.y + l.work.h / 2) / 2 }),
      prepareTrack(route), true, false);
    expect(place).toHaveBeenCalledOnce();
    expect(place.mock.calls[0][4]).toContainEqual({
      x: l.work.x, y: legendTop, w: l.work.w, h: l.readability.legendHeight,
    });
  } finally {
    place.mockRestore();
  }
});

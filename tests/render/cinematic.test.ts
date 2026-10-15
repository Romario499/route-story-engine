import { expect, it, vi } from 'vitest';
import { STYLES } from '../../src/render/styles';
import * as callouts from '../../src/render/callouts';
import { drawCinematicGeography } from '../../src/render/cinematic';
import { layoutFor, timelineOptionsFor, type Rect } from '../../src/render/layout';
import { overlayTitleBottom } from '../../src/render/overlay';
import { prepareTrack } from '../../src/render/track';
import { buildTimeline } from '../../src/story';
import { enrichmentFor, lineRoute, settings } from '../story/fixtures';
import { confirmedWaypointRoute, jw } from '../story/waypoint-fixtures';
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

it.each(['9:16', '16:9'] as const)('%s: метки показывают один знак координат, трек — четыре; ширина следует тексту', format => {
  const widths: number[] = [];
  for (const mark of [true, false]) {
    const route = mark ? confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]) :
      lineRoute(20, { lat: 41, lon0: 28.9 });
    const enrichment = { ...enrichmentFor(route), placeAt: () => null,
      countryAt: () => ({ iso2: 'TD', nameRu: 'Чад', nameEn: 'Chad' }) };
    const cfg = settings({ format, durationSec: 60 }), style = STYLES.epic, l = layoutFor(format);
    const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(1);
    const { ctx, texts } = recorder();
    const place = vi.spyOn(callouts, 'placeCallout');
    try {
      drawCinematicGeography(ctx, frame, route, enrichment, cfg, style,
        () => ({ x: (l.work.x + l.work.w / 2) / 2, y: 400 }), prepareTrack(route), true, false);
      expect(texts).toContain(mark ? '41.0° / 28.9°' : '41.0000° / 28.9000°');
      expect(place).toHaveBeenCalledOnce();
      expect(place.mock.results[0].value).not.toBeNull();
      widths.push(place.mock.calls[0][2]);
    } finally {
      place.mockRestore();
    }
  }
  expect(widths[0]).toBeLessThan(widths[1]);
});

it.each(['9:16', '16:9'] as const)('%s: outro оставляет флаг финиша и кольцо старта свободными', format => {
  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(58);
  expect(frame.act).toBe('outro');
  const model = prepareTrack(route), last = model.n - 1;
  // Синтетическая экранная геометрия: прежняя ближайшая карточка закрывала верх флага.
  model.sx[0] = 380; model.sy[0] = 360;
  model.sx[last] = 230; model.sy[last] = 400;
  model.have[0] = model.have[last] = 1;
  model.transferSeg.fill(1);
  const finish: Rect = { x: 446, y: 734, w: 56, h: 80 };
  const r = style.marker.radius * 1.5 + Math.max(2, style.marker.ringWidth / 2 * 1.6) + 2.4;
  const start: Rect = { x: 760 - r, y: 720 - r, w: r * 2, h: r * 2 };
  const { ctx, texts } = recorder();
  const place = vi.spyOn(callouts, 'placeCallout');
  try {
    drawCinematicGeography(ctx, frame, route, enrichment, cfg, style,
      () => ({ x: 230, y: 400 }), model, true, false);
    expect(place).toHaveBeenCalledOnce();
    const box = place.mock.results[0].value as Rect | null;
    expect(box).not.toBeNull();
    expect(texts).toContain('Последняя точка записи');
    for (const marker of [start, finish]) {
      expect(place.mock.calls[0][4]).toContainEqual(marker);
      expect(box!.x < marker.x + marker.w && box!.x + box!.w > marker.x &&
        box!.y < marker.y + marker.h && box!.y + box!.h > marker.y).toBe(false);
    }
  } finally {
    place.mockRestore();
  }
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

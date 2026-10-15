import { expect, it } from 'vitest';
import { layoutFor, timelineOptionsFor } from '../../src/render/layout';
import { STYLES } from '../../src/render/styles';
import { drawTrackLayer, prepareTrack } from '../../src/render/track';
import { drawWaypointLayer } from '../../src/render/waypoint-layer';
import { buildTimeline } from '../../src/story';
import { MAP_VIEWPORT } from '../../src/types';
import { enrichmentFor, settings } from '../story/fixtures';
import { confirmedWaypointRoute, jw } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';

it.each(['epic', 'atlas', 'neon'] as const)('9:16 / %s: атрибуция не разрезает соединение и не перекрывается подписью', styleId => {
  const format = '9:16', style = STYLES[styleId], view = MAP_VIEWPORT[format];
  const route = confirmedWaypointRoute([jw(40, 30, 'overnight', 0), jw(41, 31, 'overnight', 1)]);
  const enrichment = enrichmentFor(route);
  const timeline = buildTimeline(route, enrichment, settings({ format, styleId }), timelineOptionsFor(format, styleId));
  const attribution = layoutFor(format, styleId).attribution;
  // Ниже итогов (с запасом на тень), внутри полосы атрибуции. Оба конца — вне её ширины.
  const y = (attribution.y - 4) / 2;
  const from: [number, number] = [10, y], to: [number, number] = [500, y];
  const project = (lon: number) => ({ x: lon === 30 ? from[0] : to[0], y });
  for (const t of [2, 28]) {
    const frame = timeline.frameAt(t);
    expect(frame.act).not.toBe('journey');
    const line = recorder();
    drawWaypointLayer({ ctx: line.ctx, route, frame, project, style, view });
    const segments = line.strokes
      .filter(s => [style.line.ghost, style.palette.secondary].includes(s.color))
      .flatMap(s => s.segments);
    expect(segments).toEqual([{ from, to }]);

    const labels = recorder();
    drawTrackLayer({ ctx: labels.ctx, model: prepareTrack(route), route, enrichment, frame, project, style, view, lang: 'ru' });
    const cards = labels.fills.filter(r => r.w > 60 && r.h > 20 && r.alpha === 1);
    expect(cards).toHaveLength(2);
    const band = { x: (attribution.x - 6) / 2, y: (attribution.y - 76) / 2,
      w: (attribution.w + 12) / 2, h: 88 / 2 };
    for (const card of cards) {
      expect(card.x < band.x + band.w && band.x < card.x + card.w
        && card.y < band.y + band.h && band.y < card.y + card.h).toBe(false);
    }
  }
});

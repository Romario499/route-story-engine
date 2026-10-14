import { expect, it } from 'vitest';
import { drawWaypointLayer } from '../../src/render/waypoint-layer';
import { STYLES } from '../../src/render/styles';
import { MAP_VIEWPORT } from '../../src/types';
import { buildTimeline } from '../../src/story';
import { enrichmentFor, settings } from '../story/fixtures';
import { jw, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';
it('30 ночёвок на линии: значки и точки разрежены в обоих форматах, на всех стадиях; транспорт сохраняется', () => {
  const marks = Array.from({ length: 30 }, (_, i) => jw(40,30 + i * 0.02,'overnight',i));
  const route = waypointRoute(marks), env = enrichmentFor(route);
  for (const format of ['9:16','16:9'] as const) for (const styleId of ['epic','atlas'] as const) {
    const tl = buildTimeline(route,env,settings({format,styleId}));
    for (const time of [0,16,30]) {
      const rec = recorder();
      drawWaypointLayer({ctx:rec.ctx,route,frame:tl.frameAt(time),style:STYLES[styleId],view:MAP_VIEWPORT[format],project:(lon) => ({x: 100 + (lon - 30) * 150,y:200})});
      const xs = [...new Set(rec.ops.filter(s => s.startsWith('arc:')).map(s => Number(s.split(':')[1].split(',')[0])))].sort((a,b)=>a-b);
      expect(xs.length).toBeGreaterThan(0);
      expect(xs.length).toBeLessThan(15);
      for(let i=1;i<xs.length;i++) expect(xs[i]-xs[i-1]).toBeGreaterThanOrEqual(16);
    }
  }
});

it('ночёвки не пересекают кольцо старта и флаг финиша; смена транспорта сохраняется', () => {
  const route = waypointRoute(Array.from({ length: 30 }, (_, i) => jw(40, 30 + i * 0.02, i === 14 ? 'train' : 'overnight', i)));
  const env = enrichmentFor(route), cfg = settings();
  const tl = buildTimeline(route, env, cfg);
  const rec = recorder(), project = (lon: number) => ({ x: 100 + (lon - 30) * 850, y: 200 });
  const frame = tl.frameAt(16);
  drawWaypointLayer({ ctx: rec.ctx, route, frame, style: STYLES.epic, view: MAP_VIEWPORT['9:16'], project });
  const xs = [...new Set(rec.ops.filter(s => s.startsWith('arc:')).map(s => Number(s.split(':')[1].split(',')[0])))];
  for (const x of xs) {
    const i = Math.round((x - 100) / 17);
    if ([13, 14, 15].includes(i)) continue; // обязательные смены транспорта не скрываются
    expect(Math.abs(x - 100)).toBeGreaterThanOrEqual(18);
  }
  // На полном пути ромб жёлтой метки не исчезает при разрежении.
  const end = recorder();
  drawWaypointLayer({ ctx: end.ctx, route, frame: tl.frameAt(30), style: STYLES.epic, view: MAP_VIEWPORT['16:9'], project: lon => ({ x: 100 + (lon - 30) * 150, y: 200 }) });
  // Заполненный значок в окрестности смены транспорта, независимо от способа построения пути.
  expect(end.fills.some(({ x, y, w, h, alpha }) =>
    alpha > 0.5 && w > 0 && h > 0 && w <= 16 && h <= 16
    && Math.abs(x + w / 2 - 142) <= 2 && Math.abs(y + h / 2 - 200) <= 2,
  )).toBe(true);
  const endXs = [...new Set(end.ops.filter(s => s.startsWith('arc:')).map(s => Number(s.split(':')[1].split(',')[0])))];
  for (const x of endXs) {
    if ([139, 142, 145].includes(x)) continue; // обязательные метки транспорта
    expect(Math.abs(x - 100)).toBeGreaterThanOrEqual(16);
    expect(Math.abs(x - 187)).toBeGreaterThanOrEqual(16);
  }
});

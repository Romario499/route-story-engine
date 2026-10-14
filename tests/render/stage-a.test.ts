import { expect, it } from 'vitest';
import { drawOverlay } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { drawTrackLayer, prepareTrack } from '../../src/render/track';
import { timelineOptionsFor } from '../../src/render/layout';
import { buildTimeline } from '../../src/story';
import { MAP_VIEWPORT } from '../../src/types';
import { jw, waypointRoute } from '../story/waypoint-fixtures';
import { enrichmentFor, settings } from '../story/fixtures';
import { recorder } from './overlay-recorder';
import { waypointOverviewObstacles } from '../../src/render/layout';

// Independent line/rectangle intersection by interval clipping, including a 3px clearance.
function intersects(a: [number, number], b: [number, number], r: { x: number; y: number; w: number; h: number }): boolean {
  let lo = 0, hi = 1;
  for (const [p, q, min, max] of [[a[0], b[0], r.x - 3, r.x + r.w + 3], [a[1], b[1], r.y - 3, r.y + r.h + 3]]) {
    const d = q - p;
    if (!d) { if (p < min || p > max) return false; continue; }
    const t = [(min - p) / d, (max - p) / d].sort((x, y) => x - y);
    lo = Math.max(lo, t[0]); hi = Math.min(hi, t[1]);
  }
  return hi >= lo;
}

it.each(['9:16', '16:9'] as const)('исчерпание свободных позиций не возвращает подпись на препятствие: %s, три стиля', format => {
  const route = waypointRoute(Array.from({ length: 100 }, (_, i) => jw(40 + i % 10, 30 + i, 'overnight', i)));
  route.waypointOrderConfirmed = true;
  const e = enrichmentFor(route);
  const name = 'Очень длинное синтетическое название населённого пункта '.repeat(9).trim();
  e.beats = e.beats.map(b => b.place ? { ...b, place: { ...b.place, nameRu: name } } : b);
  for (const styleId of ['epic', 'atlas', 'neon'] as const) for (const t of [2, 28]) {
    const s = settings({ format, styleId }), style = STYLES[styleId], view = MAP_VIEWPORT[format], rec = recorder();
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment: e,
      frame: buildTimeline(route, e, s, timelineOptionsFor(format, styleId)).frameAt(t), lang: 'ru', style, view,
      project: lon => ({ x: 60 + ((lon - 30) % 2) * (view.width - 120), y: 65 + Math.floor((lon - 30) / 2) * (view.height - 130) / 49 }) });
    expect(rec.texts.join(' ').match(/синтетическое/g), `${format}/${styleId}/${t}: полный текст обеих подписей`).toHaveLength(18);
    const cards = rec.fills.filter(r => r.w > 60 && r.h > 20 && r.alpha === 1);
    expect(cards, `${format}/${styleId}/${t}: две видимые плашки`).toHaveLength(2);
    const obstacles = waypointOverviewObstacles(format, style).map(r => ({ x: r.x / 2, y: r.y / 2, w: r.w / 2, h: r.h / 2 }));
    const lines = rec.strokes.filter(st => [style.line.ghost, style.line.ghostCasing, style.palette.secondary].includes(st.color)).flatMap(st => st.segments);
    expect(lines.length).toBeGreaterThan(0);
    for (const r of cards) {
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(view.width);
      expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.h).toBeLessThanOrEqual(view.height);
      for (const b of obstacles.concat(cards.filter(b => b !== r)))
        expect(r.x < b.x + b.w && b.x < r.x + r.w && r.y < b.y + b.h && b.y < r.y + r.h,
          `${format}/${styleId}/${t}: плашка пересекает препятствие`).toBe(false);
      for (const line of lines) expect(intersects(line.from, line.to, r), `${format}/${styleId}/${t}: плашка пересекает пунктир`).toBe(false);
    }
    for (const r of rec.textRects) expect(cards.some(b => r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h)).toBe(true);
  }
});

it('в общем плане подписи и титры не пересекают соединения меток: оба формата, три стиля', () => {
  const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(41, 31, 'overnight', 1), jw(40, 32, 'overnight', 2)]);
  route.waypointOrderConfirmed = true;
  const e = enrichmentFor(route);
  for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas', 'neon'] as const) for (const t of [2, 28]) {
    const s = settings({ format, styleId }), style = STYLES[styleId], view = MAP_VIEWPORT[format];
    const frame = buildTimeline(route, e, s, timelineOptionsFor(format, styleId)).frameAt(t);
    const rec = recorder();
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment: e, frame, lang: 'ru', style, view,
      project: (lon, lat) => ({ x: 80 + (lon - 30) * (view.width - 160) / 2, y: view.height * (lat === 41 ? 0.15 : 0.6) }) });
    expect(rec.texts.filter(s => s.includes('Тбилиси') || s.includes('Ереван')), `${format}/${styleId}/${t}: обе крайние подписи`).toHaveLength(2);
    const overlay = recorder();
    drawOverlay(overlay.ctx, frame, { route, enrichment: e, settings: s, style, reconstruction: false });
    const rects = [...rec.textRects, ...overlay.textRects.map(r => ({ ...r, x: r.x / 2, y: r.y / 2, w: r.w / 2, h: r.h / 2 }))];
    const lines = rec.strokes.filter(st => [style.line.ghost, style.line.ghostCasing, style.palette.secondary].includes(st.color)).flatMap(st => st.segments);
    expect(lines.length).toBeGreaterThan(0);
    for (const r of rects) for (const line of lines) expect(intersects(line.from, line.to, r), `${format}/${styleId}/${t}: ${r.text}`).toBe(false);
  }
});

it('плотный пунктир не скрывает обе крайние подписи в обоих форматах и трёх стилях', () => {
  const route = waypointRoute(Array.from({ length: 100 }, (_, i) => jw(40 + i % 10, 30 + i, 'overnight', i)));
  route.waypointOrderConfirmed = true;
  const e = enrichmentFor(route);
  for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas', 'neon'] as const) for (const t of [2, 28]) {
    const s = settings({ format, styleId }), style = STYLES[styleId], view = MAP_VIEWPORT[format];
    const frame = buildTimeline(route, e, s, timelineOptionsFor(format, styleId)).frameAt(t);
    const rec = recorder();
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment: e, frame, lang: 'ru', style, view,
      project: lon => ({ x: 60 + ((lon - 30) % 2) * (view.width - 120), y: 65 + Math.floor((lon - 30) / 2) * (view.height - 130) / 49 }) });
    expect(rec.texts, `${format}/${styleId}/${t}: обе крайние подписи`).toHaveLength(2);
    const lines = rec.strokes.filter(st => [style.line.ghost, style.line.ghostCasing, style.palette.secondary].includes(st.color)).flatMap(st => st.segments);
    expect(lines.length).toBeGreaterThan(0);
    for (const r of rec.textRects) {
      expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(view.width);
      expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.h).toBeLessThanOrEqual(view.height);
      for (const line of lines) expect(intersects(line.from, line.to, r), `${format}/${styleId}/${t}: ${r.text}`).toBe(false);
    }
  }
});

it('обзор не рисует соединения, крайние подписи или направление', () => {
  const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(41, 31, 'overnight', 1), jw(40, 32, 'overnight', 2)]);
  const e = enrichmentFor(route), s = settings(), style = STYLES.epic;
  for (const t of [2, 10, 20, 28]) {
    const frame = buildTimeline(route, e, s).frameAt(t), rec = recorder();
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment: e, frame, lang: 'ru', style,
      view: MAP_VIEWPORT['9:16'], project: (lon, lat) => ({ x: lon * 8, y: lat * 8 }) });
    expect(rec.texts).toEqual([]);
    expect(rec.strokes.flatMap(st => st.segments)).toEqual([]);
    drawOverlay(rec.ctx, frame, { route, enrichment: e, settings: s, style, reconstruction: false });
    expect(rec.texts.join(' ')).not.toMatch(/Старт|Финиш|→/);
    expect(rec.texts.join(' ')).toMatch(/обзор по меткам/i);
  }
});

it('длинные обязательные подписи остаются целиком внутри кадра, не пересекаются с пунктиром и друг другом', () => {
  const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(41, 31, 'overnight', 1), jw(40, 32, 'overnight', 2)]);
  route.waypointOrderConfirmed = true;
  const e = enrichmentFor(route);
  e.beats = e.beats.map(b => b.place ? { ...b, place: { ...b.place, nameRu: b.kind === 'start'
    ? 'Длинное синтетическое название первого населённого пункта на карте'
    : 'Длинное синтетическое название последнего населённого пункта на карте' } } : b);
  for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas', 'neon'] as const) for (const t of [2, 28]) {
    const s = settings({ format, styleId }), style = STYLES[styleId], view = MAP_VIEWPORT[format], rec = recorder();
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment: e,
      frame: buildTimeline(route, e, s, timelineOptionsFor(format, styleId)).frameAt(t), lang: 'ru', style, view,
      project: (lon, lat) => ({ x: 80 + (lon - 30) * (view.width - 160) / 2, y: view.height * (lat === 41 ? 0.15 : 0.6) }) });
    expect(rec.texts.join(' ')).toContain('первого'); expect(rec.texts.join(' ')).toContain('последнего');
    const lines = rec.strokes.filter(st => [style.line.ghost, style.line.ghostCasing, style.palette.secondary].includes(st.color)).flatMap(st => st.segments);
    for (const r of rec.textRects) {
      expect(r.x, `${format}/${styleId}: ${r.text}`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(view.width);
      expect(r.y).toBeGreaterThanOrEqual(0); expect(r.y + r.h).toBeLessThanOrEqual(view.height);
      for (const line of lines) expect(intersects(line.from, line.to, r)).toBe(false);
    }
    for (let i = 0; i < rec.textRects.length; i++) for (const b of rec.textRects.slice(i + 1)) {
      const a = rec.textRects[i];
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
    }
  }
});

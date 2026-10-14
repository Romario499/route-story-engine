import { describe, expect, it } from 'vitest';
import { enrichRoute } from '../../src/geo';
import { drawOverlay, resolveTitle } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { timelineOptionsFor } from '../../src/render/layout';
import { buildTimeline } from '../../src/story';
import { armenia, georgia, settings, tbilisi, yerevan } from '../story/fixtures';
import { jw, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';
import { drawIcon } from '../../src/render/assets';
import { drawTrackLayer, prepareTrack } from '../../src/render/track';
import { MAP_VIEWPORT } from '../../src/types';

describe('ремонт порядка меток', () => {
  it('подтверждённый порядок создания не зависит от порядка файла; неизвестный конец не подменяется внутренней страной', () => {
    const route = waypointRoute([jw(41, 40, 'overnight', 2), jw(40, 44, 'overnight', 0), jw(41, 30, 'overnight', 1)]);
    const e = enrichRoute(route, {
      countryAt: (lon) => lon === 30 ? null : lon === 40 ? georgia : armenia,
      nearestPlace: (lon) => lon === 30 ? null : lon === 40 ? tbilisi : yerevan,
    });
    const tl = buildTimeline(route, e, settings());
    expect(tl.frameAt(0).headLonLat).toEqual([44, 40]);
    expect(tl.frameAt(30).headLonLat).toEqual([40, 41]);
    expect(route.points.map(p => p.lon)).toEqual([44, 30, 40]);
    expect(e.beats.find((b) => b.kind === 'start')).toMatchObject({ idx: 0, place: yerevan });
    expect(e.beats.find((b) => b.kind === 'finish')).toMatchObject({ idx: 2, place: tbilisi });
    expect(resolveTitle('en', '', route, { ...e, countryRuns: e.countryRuns.map(r => r.toIdx === 2 ? { ...r, country: null } : r) })).toBe('My journey');
    const known = enrichRoute(route, {
      countryAt: (lon) => lon < 44 ? georgia : armenia,
      nearestPlace: (lon) => lon < 44 ? tbilisi : yerevan,
    });
    expect(resolveTitle('ru', '', route, known)).toBe('Армения → Грузия');
    expect(resolveTitle('en', '', route, known)).toBe('Armenia → Georgia');
    const rec = recorder();
    drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment: known, lang: 'en',
      frame: tl.frameAt(30), style: STYLES.epic, view: MAP_VIEWPORT['9:16'],
      project: (lon) => ({ x: 100 + (lon - 30) * 20, y: 450 }),
    });
    // F3 (G90): у меток город — только «рядом», не место старта/финиша
    expect(rec.texts).toContain('Start · near Yerevan');
    expect(rec.texts).toContain('Finish · near Tbilisi');
    expect(rec.texts).not.toContain('Start — Yerevan');
    // Флаг у последней по времени создания подтверждённой метки (x=300), не у первой в файле по индексу хранения.
    expect(rec.fills.some((r) => r.x > 300 && r.x < 310 && r.w > 10 && r.h > 5)).toBe(true);
  });

  it('перелёт между странами: каждый кадр не утверждает страну отправления, слот показывает A → B RU/EN до прибытия', () => {
    const route = waypointRoute([jw(41, 40, 'overnight', 0), jw(40, 100, 'overnight', 1)]);
    const e = enrichRoute(route, { countryAt: (lon) => lon === 40 ? georgia : armenia, nearestPlace: () => null });
    for (const format of ['9:16', '16:9'] as const) for (const lang of ['ru', 'en'] as const) {
      const s = settings({ format, lang, title: '' });
      const tl = buildTimeline(route, e, s, timelineOptionsFor(format));
      let plaques = 0, arrivals = 0;
      for (let i = 0; i <= tl.frameCount; i++) {
        const f = tl.frameAt(i / 30);
        if (f.act !== 'journey') continue;
        if (f.head > 0 && f.head < 1) {
          expect(f.stats.country, `head=${f.head}`).toBeNull();
          if (f.cards.length || f.t < 8) continue;
          const rec = recorder();
          drawOverlay(rec.ctx, f, { route, enrichment: e, settings: s, style: STYLES.epic, reconstruction: false });
          const label = lang === 'ru' ? 'Грузия → Армения' : 'Georgia → Armenia';
          expect(rec.texts).toContain(label);
          expect(rec.texts).not.toContain(lang === 'ru' ? 'Грузия' : 'Georgia');
          plaques++;
        } else if (f.head === 1) {
          expect(f.stats.country).toEqual(armenia);
          expect(f.countryChange?.from).toBeNull();
          arrivals++;
        }
      }
      expect(plaques).toBeGreaterThan(30);
      expect(arrivals).toBeGreaterThan(0);
    }
  });

  it('палатка имеет отдельный вход под крышей вместо штриха от вершины к основанию', () => {
    const icon = recorder();
    drawIcon(icon.ctx, 'tent', 0, 0, 2, '#test');
    const segments = icon.strokes.flatMap((s) => s.segments);
    // У палатки есть вход внутри контура, начинающийся ниже крыши; предупреждающий треугольник его не имеет.
    expect(segments.some(({ from, to }) => Math.abs(from[0]) < 0.5 && Math.abs(to[0]) < 0.5
      && from[1] > -0.5 && to[1] > -0.5 && Math.abs(from[1] - to[1]) > 0.15)).toBe(true);
    expect(segments.some(({ from, to }) => Math.abs(from[0]) < 0.3 && from[1] < -0.6
      && Math.abs(to[0]) < 0.3 && to[1] > 0.5)).toBe(false);
  });

  it('палатка прилегает к числу ночёвок в обоих форматах и всех стилях', () => {
    const route = waypointRoute(Array.from({ length: 5 }, (_, i) => jw(41, 40 + i * 0.25, 'overnight', 0)));
    const e = enrichRoute(route, { countryAt: () => georgia, nearestPlace: () => null });
    for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas', 'neon'] as const) {
      const s = settings({ format, styleId, info: { ...settings().info, progress: true, day: true } });
      const tl = buildTimeline(route, e, s, timelineOptionsFor(format, styleId));
      const f = Array.from({ length: tl.frameCount }, (_, i) => tl.frameAt(i / 30)).find((f) => f.head > 0.2 && f.head < 0.8)!;
      const rec = recorder();
      drawOverlay(rec.ctx, f, { route, enrichment: e, settings: s, style: STYLES[styleId], reconstruction: false });
      const label = rec.textRects.find((r) => r.text === 'Места ночёвок')!;
      const digit = rec.textRects.find((r) => r.text === '1' && Math.abs(r.x + r.w - label.x - label.w) < 1
        && r.y < label.y && label.y - r.y < 140)!;
      expect(digit, `${format} ${styleId}: число ночёвок`).toBeDefined();
      const tent = rec.strokes.find((stroke) => {
        const points = stroke.segments.flatMap((s) => [s.from, s.to]);
        const width = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]));
        // Отделяем знак от длинных разделителей сетки; измеряем настоящие штрихи, не подмену drawIcon.
        return width <= 60 && stroke.segments.some(({ from, to }) => Math.abs(from[0] - to[0]) > 35
          && Math.abs(from[1] - to[1]) < 0.01 && Math.abs(from[1] - (digit.y + digit.h / 2)) < 45);
      });
      expect(tent, `${format} ${styleId}: палатка возле числа`).toBeDefined();
      const points = tent!.segments.flatMap((s) => [s.from, s.to]);
      const right = Math.max(...points.map((p) => p[0]));
      const top = Math.min(...points.map((p) => p[1])), bottom = Math.max(...points.map((p) => p[1]));
      expect(digit.x - right, `${format} ${styleId}: горизонтальный зазор`).toBeGreaterThanOrEqual(0);
      expect(digit.x - right, `${format} ${styleId}: горизонтальный зазор`).toBeLessThanOrEqual(24);
      expect(Math.abs((top + bottom) / 2 - (digit.y + digit.h / 2))).toBeLessThanOrEqual(24);
      // Пять ночёвочных меток в один день остаются одной ночью и в итогах, а не только в чистом модуле.
      const summary = recorder();
      drawOverlay(summary.ctx, tl.frameAt(30), { route, enrichment: e, settings: s, style: STYLES[styleId], reconstruction: false });
      expect(summary.texts).toContain('мест ночёвок');
      expect(summary.texts).not.toContain('день · по меткам');
      expect(summary.texts).toContain('5');
    }
  });
});

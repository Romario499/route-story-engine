import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/synthetic/waypoint-sample.json?raw';
import { buildRoute, parseRouteFiles, parseRouteText } from '../../src/route';
import type { Route } from '../../src/types';

// Огрублённая выборка участка (scripts/waypoints-sample.mjs) открывается тем же импортом, что GPX/KML.

function routeOf(name: string, text: string): Route {
  const parsed = parseRouteText(name, text);
  if (!parsed.ok) throw new Error(parsed.error);
  const route = buildRoute(parsed.tracks);
  if ('error' in route) throw new Error(route.error);
  return route;
}

const mark = (lat: number, lon: number, markedAt: number, color = 'green', kind = 'overnight') => (
  { lat, lon, color, kind, confidence: 'stated', markedAt, source: { file: 'Synthetic', collection: 'Synthetic' }, duplicates: 0 });
const sample = (waypoints: unknown[]) => JSON.stringify({ source: { kind: 'waypoints' }, segment: { from: '2025-03-01', to: '2025-03-31' }, waypoints });

describe('импорт выборки участка по меткам', () => {
  it('файл выборки становится маршрутом по меткам: без трека, без километража', () => {
    const route = routeOf('waypoints-sample.json', fixture);
    expect(route.source?.kind).toBe('waypoints');
    expect(route.journeyWaypoints).toHaveLength(6);
    expect(route.totalM).toBe(0);
    expect(route.hasTime).toBe(false);
    expect(route.journeyWaypoints!.map((p) => p.kind)).toEqual(['overnight', 'overnight', 'overnight', 'train', 'overnight', 'overnight']);
    // метки идут от самой ранней к самой поздней, а названий в выборке нет
    expect(route.journeyWaypoints!.every((p, i, all) => i === 0 || all[i - 1].markedAt! <= p.markedAt!)).toBe(true);
    expect(route.journeyWaypoints!.every((p) => p.name === '')).toBe(true);
  });

  it('старт — самая ранняя метка участка, без «семени» Турции', () => {
    // самая ранняя метка далеко от Турции, а более поздняя зелёная лежит в рамке Турции после 2024-11:
    // выбор «от первой зелёной в Турции» обрезал бы начало участка
    const early = Date.UTC(2025, 6, 14, 12), later = Date.UTC(2025, 7, 11, 12);
    const route = routeOf('x.json', sample([mark(43.1, 58.3, early), mark(40.2, 30.5, later, 'lime'), mark(39.7, 66.9, later + 86_400_000)]));
    expect(route.journeyWaypoints).toHaveLength(3);
    expect(route.journeyWaypoints![0]).toMatchObject({ lat: 43.1, lon: 58.3, markedAt: early });
    expect(route.points[0]).toMatchObject({ lat: 43.1, lon: 58.3 });
  });

  it('читается и через выбор файла в браузере (parseRouteFiles)', async () => {
    const parsed = await parseRouteFiles([new File([fixture], 'waypoints-sample.json')]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.tracks[0].kmlImport?.points).toHaveLength(6);
  });

  it('битые метки пропускаются с предупреждением, пустая выборка — понятная ошибка', () => {
    const parsed = parseRouteText('x.json', sample([mark(40, 30, 1), mark(95, 30, 2), { lat: 'x' }, mark(41, 31, 3)]));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.tracks[0].kmlImport?.points).toHaveLength(2);
      expect(parsed.warnings.join(' ')).toMatch(/2/);
    }
    const empty = parseRouteText('x.json', sample([]));
    expect(empty).toMatchObject({ ok: false });
  });

  it('обычный GeoJSON не принимается за выборку', () => {
    const geo = parseRouteText('x.geojson', JSON.stringify({ type: 'LineString', coordinates: [[30, 40], [30.1, 40.1]] }));
    expect(geo.ok && geo.tracks[0].segments[0]).toHaveLength(2);
  });
});

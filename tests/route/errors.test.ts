import { describe, expect, it } from 'vitest';
import { buildRoute, parseRouteText, ROUTE_ERRORS } from '../../src/route';

import emptyGpx from '../fixtures/empty.gpx?raw';
import garbageGpx from '../fixtures/garbage.gpx?raw';
import kml from '../fixtures/track.kml?raw';
import singlePoint from '../fixtures/single-point.gpx?raw';
import noPoints from '../fixtures/no-points.gpx?raw';
import brokenGeojson from '../fixtures/broken.geojson?raw';
import noCoordsCsv from '../fixtures/no-coords.csv?raw';

/** Ошибка всего конвейера «разбор → маршрут», как её увидит пользователь. */
function pipelineError(name: string, text: string): string | null {
  const parsed = parseRouteText(name, text);
  if (!parsed.ok) return parsed.error;
  const route = buildRoute(parsed.tracks);
  return 'error' in route ? route.error : null;
}

describe('ROUTE_ERRORS', () => {
  it('тексты — дословно из истории 7 спецификации', () => {
    expect(ROUTE_ERRORS.unreadable('повреждён')).toBe('Не удалось прочитать файл: повреждён');
    expect(ROUTE_ERRORS.empty).toBe('В файле нет точек маршрута');
    expect(ROUTE_ERRORS.unsupported).toBe('Формат не поддерживается — нужен GPX, KML, KMZ, GeoJSON или CSV');
    expect(ROUTE_ERRORS.tooFew).toBe('Меньше 2 точек — нечего анимировать');
  });

  it('пустой файл, мусор, чужой формат и одна точка дают четыре разных понятных текста', () => {
    const errors = [
      pipelineError('empty.gpx', emptyGpx),
      pipelineError('garbage.gpx', garbageGpx),
      pipelineError('track.fit', kml),
      pipelineError('single-point.gpx', singlePoint),
    ];
    expect(errors[0]).toBe(ROUTE_ERRORS.empty);
    expect(errors[1]).toMatch(/^Не удалось прочитать файл: .+/);
    expect(errors[2]).toBe(ROUTE_ERRORS.unsupported);
    expect(errors[3]).toBe(ROUTE_ERRORS.tooFew);
    expect(new Set(errors).size).toBe(4);
  });

  it('GPX без точек — «нет точек»; обрезанный GeoJSON и CSV без координат — «не удалось прочитать»', () => {
    expect(pipelineError('no-points.gpx', noPoints)).toBe(ROUTE_ERRORS.empty);
    expect(pipelineError('broken.geojson', brokenGeojson)).toMatch(/^Не удалось прочитать файл: .+/);
    expect(pipelineError('no-coords.csv', noCoordsCsv)).toMatch(/^Не удалось прочитать файл: .+/);
  });

  it('неизвестное расширение с непонятным содержимым — «не поддерживается»', () => {
    expect(pipelineError('notes.txt', 'просто текст\nбез координат')).toBe(ROUTE_ERRORS.unsupported);
    expect(pipelineError('export.xml', kml)).toBeNull();
  });
});

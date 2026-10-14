import { describe, expect, it } from 'vitest';
import { parseRouteText } from '../../src/route';
import type { ParseResult, RawTrack } from '../../src/types';

import trackGpx from '../fixtures/track.gpx?raw';
import routeGpx from '../fixtures/route.gpx?raw';
import trackGeojson from '../fixtures/track.geojson?raw';
import multiGeojson from '../fixtures/multi.geojson?raw';
import commaCsv from '../fixtures/track-comma.csv?raw';
import semicolonCsv from '../fixtures/track-semicolon.csv?raw';

function okTracks(r: ParseResult): RawTrack[] {
  if (!r.ok) throw new Error(`ожидался успешный разбор, получено: ${r.error}`);
  return r.tracks;
}

describe('parseRouteText — GPX', () => {
  it('читает trk/trkseg/trkpt с ele и time, не видит закомментированные точки', () => {
    const [track] = okTracks(parseRouteText('track.gpx', trackGpx));
    expect(track.sourceFile).toBe('track.gpx');
    expect(track.name).toBe('День 1: Трабзон — Ризе');
    expect(track.segments.map((s) => s.length)).toEqual([8, 4]);
    const p0 = track.segments[0][0];
    expect(p0.lat).toBeCloseTo(41.0027, 6);
    expect(p0.lon).toBeCloseTo(39.7168, 6);
    expect(p0.ele).toBeCloseTo(30, 6);
    expect(p0.time).toBe(Date.UTC(2024, 4, 1, 6, 0, 0));
    const last = track.segments[1][3];
    expect(last.time).toBe(Date.UTC(2024, 4, 1, 7, 3, 0));
    expect(last.ele).toBeCloseTo(86, 6);
  });

  it('читает именованные wpt (сущности и CDATA), безымянные пропускает', () => {
    const [track] = okTracks(parseRouteText('track.gpx', trackGpx));
    expect(track.waypoints).toEqual([
      { lat: 41.005, lon: 39.73, name: 'Кафе & заправка' },
      { lat: 41.016, lon: 39.782, name: 'Смотровая <Боздаг>' },
    ]);
  });

  it('читает rte/rtept как маршрут без времени и высоты', () => {
    const [track] = okTracks(parseRouteText('route.gpx', routeGpx));
    expect(track.name).toBe('Батуми — Тбилиси (план)');
    expect(track.segments).toHaveLength(1);
    expect(track.segments[0]).toHaveLength(5);
    expect(track.segments[0][4]).toEqual({ lat: 41.7151, lon: 44.8271 });
  });

  it('распознаёт GPX по содержимому при неизвестном расширении', () => {
    const [track] = okTracks(parseRouteText('export.xml', routeGpx));
    expect(track.segments[0]).toHaveLength(5);
  });
});

describe('parseRouteText — GeoJSON', () => {
  it('FeatureCollection: LineString [lon,lat,ele] + coordTimes, Point с именем — остановка', () => {
    const [track] = okTracks(parseRouteText('track.geojson', trackGeojson));
    expect(track.name).toBe('Ереван — Севан');
    expect(track.segments).toHaveLength(1);
    const seg = track.segments[0];
    expect(seg).toHaveLength(5);
    expect(seg[0]).toEqual({ lat: 40.1872, lon: 44.5152, ele: 990, time: Date.UTC(2024, 4, 10, 5, 0, 0) });
    expect(seg[4].time).toBe(Date.UTC(2024, 4, 10, 5, 40, 0));
    expect(track.waypoints).toEqual([{ lat: 40.564, lon: 44.951, name: 'Монастырь Севанаванк' }]);
  });

  it('Feature с MultiLineString и properties.times (вложенные массивы) — два сегмента', () => {
    const [track] = okTracks(parseRouteText('multi.json', multiGeojson));
    expect(track.segments.map((s) => s.length)).toEqual([3, 2]);
    expect(track.segments[0][1]).toEqual({ lat: 41.31, lon: 69.26, time: 1715000300000 });
    expect(track.segments[1][1].time).toBe(1715007500000);
    expect(track.segments[0][0].ele).toBeUndefined();
  });

  it('голая геометрия LineString и одиночный Feature', () => {
    const line = JSON.stringify({ type: 'LineString', coordinates: [[10, 50], [10.1, 50.1, 200]] });
    const [t1] = okTracks(parseRouteText('line.geojson', line));
    expect(t1.segments[0]).toEqual([{ lat: 50, lon: 10 }, { lat: 50.1, lon: 10.1, ele: 200 }]);

    const feature = JSON.stringify({
      type: 'Feature',
      properties: { coordTimes: ['2024-01-01T00:00:00Z', '2024-01-01T00:01:00Z'] },
      geometry: { type: 'LineString', coordinates: [[10, 50], [10.1, 50.1]] },
    });
    const [t2] = okTracks(parseRouteText('one.geojson', feature));
    expect(t2.segments[0][1].time).toBe(Date.UTC(2024, 0, 1, 0, 1, 0));
  });
});

describe('parseRouteText — CSV', () => {
  it('разделитель «,», английские заголовки в любом порядке, лишние колонки игнорируются', () => {
    const [track] = okTracks(parseRouteText('track.csv', commaCsv));
    const seg = track.segments[0];
    expect(seg).toHaveLength(4);
    expect(seg[0]).toEqual({ lat: 42.8746, lon: 74.5698, ele: 780, time: Date.UTC(2024, 4, 20, 4, 0, 0) });
    expect(seg[3].ele).toBeCloseTo(815, 6);
  });

  it('разделитель «;», русские заголовки, десятичная запятая, дата дд.мм.гггг, BOM и CRLF', () => {
    const [track] = okTracks(parseRouteText('Трек.csv', semicolonCsv));
    const seg = track.segments[0];
    expect(seg).toHaveLength(3);
    expect(seg[0].lat).toBeCloseTo(43.2389, 6);
    expect(seg[0].lon).toBeCloseTo(76.9457, 6);
    expect(seg[0].ele).toBeCloseTo(850.5, 6);
    expect(seg[0].time).toBe(Date.UTC(2024, 4, 21, 3, 0, 0));
    expect(seg[2].time).toBe(Date.UTC(2024, 4, 21, 3, 12, 0));
  });

  it('распознаёт заголовки lat/lng/alt/time и epoch-секунды', () => {
    const csv = 'lat,lng,alt,time\n41.1,69.2,500,1715000000\n41.2,69.3,510,1715000060\n';
    const [track] = okTracks(parseRouteText('points.csv', csv));
    expect(track.segments[0][1]).toEqual({ lat: 41.2, lon: 69.3, ele: 510, time: 1715000060000 });
  });

  it('CSV без времени и высоты — только координаты', () => {
    const csv = 'Latitude;Longitude\n41,5;69,25\n41,6;69,35\n';
    const [track] = okTracks(parseRouteText('plain.csv', csv));
    expect(track.segments[0]).toEqual([{ lat: 41.5, lon: 69.25 }, { lat: 41.6, lon: 69.35 }]);
  });
});

// GeoJSON: LineString / MultiLineString / MultiPoint как трек, именованные Point — остановки.
// Время точек: properties.coordTimes (togeojson, Strava), properties.times или coordinateProperties.times.
import type { RawTrack, TrackPoint, Waypoint } from '../types';
import { ROUTE_ERRORS, RouteParseError } from './errors';
import { parseTime } from './time';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const GEOJSON_TYPES = new Set([
  'FeatureCollection', 'Feature', 'GeometryCollection',
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon',
]);

export function looksLikeJson(text: string): boolean {
  const c = text.trimStart()[0];
  return c === '{' || c === '[';
}

function timesOf(props: Json): unknown[] | undefined {
  const cp = props.coordinateProperties;
  const t = props.coordTimes ?? props.times ?? (isObj(cp) ? cp.times : undefined);
  return Array.isArray(t) ? t : undefined;
}

export function parseGeoJson(fileName: string, text: string): { track: RawTrack; warnings: string[] } {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new RouteParseError(ROUTE_ERRORS.unreadable('файл GeoJSON повреждён или обрезан'));
  }
  if (!isObj(root) || typeof root.type !== 'string' || !GEOJSON_TYPES.has(root.type)) {
    throw new RouteParseError(ROUTE_ERRORS.unreadable('это не GeoJSON — нет поля «type» с геометрией'));
  }

  const segments: TrackPoint[][] = [];
  const waypoints: Waypoint[] = [];
  let name: string | undefined;
  let bad = 0;

  const toLine = (coords: unknown, times: unknown[] | undefined, offset: number): TrackPoint[] => {
    const out: TrackPoint[] = [];
    if (!Array.isArray(coords)) return out;
    for (let i = 0; i < coords.length; i++) {
      const c = coords[i];
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') { bad++; continue; }
      const p: TrackPoint = { lat: c[1], lon: c[0] };
      if (typeof c[2] === 'number' && Number.isFinite(c[2])) p.ele = c[2];
      if (times) {
        const t = parseTime(times[offset + i]);
        if (t !== undefined) p.time = t;
      }
      out.push(p);
    }
    return out;
  };

  const pushSeg = (s: TrackPoint[]) => { if (s.length) segments.push(s); };

  const walkGeometry = (g: unknown, props: Json, useTimes: boolean) => {
    if (!isObj(g)) return;
    const times = useTimes ? timesOf(props) : undefined;
    const lineCountBefore = segments.length;
    switch (g.type) {
      case 'LineString':
      case 'MultiPoint':
        pushSeg(toLine(g.coordinates, times, 0));
        break;
      case 'MultiLineString': {
        const lines = Array.isArray(g.coordinates) ? g.coordinates : [];
        const nested = !!times && Array.isArray(times[0]);
        let offset = 0;
        lines.forEach((line, i) => {
          const lt = nested ? (Array.isArray(times![i]) ? (times![i] as unknown[]) : undefined) : times;
          pushSeg(toLine(line, lt, nested ? 0 : offset));
          if (Array.isArray(line)) offset += line.length;
        });
        break;
      }
      case 'Point': {
        const c = g.coordinates;
        const label = props.name ?? props.title;
        if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number' && typeof label === 'string' && label.trim()) {
          waypoints.push({ lat: c[1], lon: c[0], name: label.trim() });
        }
        break;
      }
      case 'GeometryCollection':
        if (Array.isArray(g.geometries)) for (const sub of g.geometries) walkGeometry(sub, props, false);
        break;
      default:
        break;
    }
    if (segments.length > lineCountBefore && name === undefined && typeof props.name === 'string' && props.name.trim()) {
      name = props.name.trim();
    }
  };

  const walkFeature = (f: unknown) => {
    if (!isObj(f)) return;
    if (f.type === 'Feature') walkGeometry(f.geometry, isObj(f.properties) ? f.properties : {}, true);
    else walkGeometry(f, {}, false);
  };

  if (root.type === 'FeatureCollection') {
    if (Array.isArray(root.features)) for (const f of root.features) walkFeature(f);
    if (name === undefined && typeof root.name === 'string' && root.name.trim()) name = root.name.trim();
  } else {
    walkFeature(root);
  }

  const warnings: string[] = [];
  if (bad) warnings.push(`${fileName}: пропущено точек без координат — ${bad}`);
  const track: RawTrack = { sourceFile: fileName, segments, waypoints };
  if (name) track.name = name;
  return { track, warnings };
}

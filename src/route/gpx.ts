// GPX без DOM: однопроходный строковый сканер тегов (работает в воркере, в Node и на сотнях тысяч точек).
import type { RawTrack, TrackPoint, Waypoint } from '../types';
import { ROUTE_ERRORS, RouteParseError } from './errors';
import { parseTime } from './time';

// <tag attrs> | </tag> | <tag/>, префикс пространства имён (gpx:trkpt) отбрасывается
const TAG = /<(\/?)(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)([^>]*)>/g;
const ATTR_LAT = /\blat\s*=\s*["']([^"']*)["']/;
const ATTR_LON = /\blon\s*=\s*["']([^"']*)["']/;
const TEXT_TAGS = new Set(['ele', 'time', 'name']);
const POINT_TAGS = new Set(['trkpt', 'rtept', 'wpt']);

export function looksLikeGpx(text: string): boolean {
  return /<(?:[A-Za-z_][\w.-]*:)?gpx[\s>]/.test(text.slice(0, 4096));
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeText(raw: string): string {
  let s = raw;
  if (s.includes('&')) {
    s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }
  return s.trim();
}

/** Добавить непустой отрезок (вынесено в функцию: TS не видит присваиваний из замыкания). */
function flush(target: TrackPoint[][], s: TrackPoint[] | null): void {
  if (s && s.length) target.push(s);
}

interface OpenPoint { tag: string; lat: number; lon: number; ele?: number; time?: number; name?: string }

export function parseGpx(fileName: string, input: string): { track: RawTrack; warnings: string[] } {
  if (!looksLikeGpx(input)) throw new RouteParseError(ROUTE_ERRORS.unreadable('внутри не GPX — возможно, файл повреждён или переименован'));
  let text = input.includes('<!--') ? input.replace(/<!--[\s\S]*?-->/g, '') : input;
  // CDATA → экранированный текст, чтобы «<» внутри не принимались за теги
  if (text.includes('<![CDATA[')) {
    text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, c: string) =>
      c.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  }

  const trkSegments: TrackPoint[][] = [];
  const rteSegments: TrackPoint[][] = [];
  const waypoints: Waypoint[] = [];
  const stack: string[] = [];
  let seg: TrackPoint[] | null = null;      // открытый trkseg
  let trkLoose: TrackPoint[] | null = null; // trkpt прямо в trk без trkseg
  let rte: TrackPoint[] | null = null;
  let point: OpenPoint | null = null;
  let textStart = -1;
  let trkName: string | undefined;
  let rteName: string | undefined;
  let metaName: string | undefined;
  let badPoints = 0;
  let closedRoot = false;

  const finishPoint = (p: OpenPoint) => {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) { badPoints++; return; }
    if (p.tag === 'wpt') {
      if (p.name) waypoints.push({ lat: p.lat, lon: p.lon, name: p.name });
      return;
    }
    const tp: TrackPoint = { lat: p.lat, lon: p.lon };
    if (p.ele !== undefined) tp.ele = p.ele;
    if (p.time !== undefined) tp.time = p.time;
    if (p.tag === 'rtept') (rte ??= []).push(tp);
    else if (seg) seg.push(tp);
    else (trkLoose ??= []).push(tp);
  };

  TAG.lastIndex = 0;
  for (let m = TAG.exec(text); m; m = TAG.exec(text)) {
    const closing = m[1] === '/';
    const name = m[2];
    const attrs = m[3];
    if (!closing) {
      const selfClosing = attrs.endsWith('/');
      if (POINT_TAGS.has(name)) {
        const lat = ATTR_LAT.exec(attrs);
        const lon = ATTR_LON.exec(attrs);
        const p: OpenPoint = { tag: name, lat: lat ? Number(lat[1]) : NaN, lon: lon ? Number(lon[1]) : NaN };
        if (selfClosing) finishPoint(p);
        else point = p;
      } else if (name === 'trkseg') {
        seg = [];
      } else if (name === 'rte') {
        rte = [];
      } else if (name === 'trk') {
        trkLoose = null;
      }
      if (!selfClosing) {
        stack.push(name);
        if (TEXT_TAGS.has(name)) textStart = TAG.lastIndex;
      }
      continue;
    }

    // закрывающий тег: снимаем стек до него (терпим кривую вложенность)
    const at = stack.lastIndexOf(name);
    if (at < 0) continue;
    const parent = at > 0 ? stack[at - 1] : '';
    stack.length = at;

    if (TEXT_TAGS.has(name) && textStart >= 0) {
      const value = text.slice(textStart, m.index);
      textStart = -1;
      if (point && POINT_TAGS.has(parent)) {
        if (name === 'ele') {
          const v = Number(value.trim());
          if (value.trim() !== '' && Number.isFinite(v)) point.ele = v;
        } else if (name === 'time') {
          point.time = parseTime(value);
        } else {
          point.name = decodeText(value) || undefined;
        }
      } else if (name === 'name') {
        if (parent === 'trk') trkName ??= decodeText(value) || undefined;
        else if (parent === 'rte') rteName ??= decodeText(value) || undefined;
        else if (parent === 'metadata') metaName ??= decodeText(value) || undefined;
      }
    } else if (POINT_TAGS.has(name)) {
      if (point) finishPoint(point);
      point = null;
    } else if (name === 'trkseg') {
      if (seg && seg.length) trkSegments.push(seg);
      seg = null;
    } else if (name === 'trk') {
      if (seg && seg.length) trkSegments.push(seg);
      flush(trkSegments, trkLoose);
      seg = null; trkLoose = null;
    } else if (name === 'rte') {
      if (rte && rte.length) rteSegments.push(rte);
      rte = null;
    } else if (name === 'gpx') {
      closedRoot = true;
    }
  }
  // обрезанный файл: забираем то, что успели прочитать
  if (point) finishPoint(point);
  if (seg && seg.length) trkSegments.push(seg);
  flush(trkSegments, trkLoose);
  flush(rteSegments, rte);

  const warnings: string[] = [];
  if (!closedRoot) warnings.push(`${fileName}: файл обрезан — прочитано то, что удалось`);
  if (badPoints) warnings.push(`${fileName}: пропущено точек без координат — ${badPoints}`);

  let segments = trkSegments;
  let trackName = trkName;
  if (!trkSegments.length) {
    segments = rteSegments;
    trackName = rteName;
  } else if (rteSegments.length) {
    warnings.push(`${fileName}: в файле есть и трек, и маршрут — взят трек`);
  }
  const track: RawTrack = { sourceFile: fileName, segments, waypoints };
  const nm = trackName ?? metaName;
  if (nm) track.name = nm;
  return { track, warnings };
}

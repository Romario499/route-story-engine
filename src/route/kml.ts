import type { JourneyWaypoint, RawTrack, TrackPoint } from '../types';
import { parseTime } from './time';
import { child, descendants, localName, parseXml, value } from './xml';
import type { XmlNode } from './xml';
import { WAYPOINT_COLOR_SEMANTICS } from './waypoints';
import { ROUTE_ERRORS, RouteParseError } from './errors';

export function looksLikeKml(text: string): boolean { return /<(?:[\w.-]+:)?kml[\s/>]/.test(text.slice(0, 4096)); }

function coord(text: string, separator: RegExp): TrackPoint | null {
  const parts = text.trim().split(separator);
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  const [lon, lat, ele] = parts.map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  const p: TrackPoint = { lon, lat };
  if (parts.length > 2 && parts[2] && Number.isFinite(ele)) p.ele = ele;
  return p;
}

export function parseKml(fileName: string, text: string, allowNetworkLinks = false): { track: RawTrack; warnings: string[] } {
  const root = parseXml(text), document = child(root, 'Document') ?? root;
  const links = descendants(root, 'NetworkLink');
  if (links.length && !allowNetworkLinks) throw new RouteParseError(ROUTE_ERRORS.unreadable('ссылки KML разрешены только на файлы внутри KMZ'));
  const track: RawTrack = { sourceFile: fileName, segments: [], waypoints: [] };
  const name = value(document, 'name');
  if (name) track.name = name;
  for (const line of descendants(root, 'LineString')) {
    const points = value(line, 'coordinates').split(/\s+/).map((s) => coord(s, /,/)).filter((p): p is TrackPoint => p !== null);
    if (points.length) track.segments.push(points);
  }
  for (const line of descendants(root, 'Track')) {
    const times = line.children.filter((n) => n.name.split(':').pop() === 'when').map((n) => parseTime(n.text));
    const points: TrackPoint[] = [];
    line.children.filter((n) => n.name.split(':').pop() === 'coord').forEach((n, i) => {
      const p = coord(n.text, /\s+/);
      if (p) { if (times[i] !== undefined) p.time = times[i]; points.push(p); }
    });
    if (points.length) track.segments.push(points);
  }
  const styles = new Map<string, XmlNode>();
  const organic = descendants(root, 'styleUrl').some((n) => /^#placemark-[a-z]+$/.test(n.text.trim()));
  for (const n of [...descendants(root, 'Style'), ...descendants(root, 'StyleMap')]) if (n.attrs.id) styles.set(n.attrs.id, n);
  const colorOf = (node: XmlNode, seen = new Set<string>()): string => {
    const inline = child(node, 'Style');
    const url = value(node, 'styleUrl').replace(/^#/, '');
    const organic = /^placemark-([a-z]+)$/.exec(url);
    if (organic) return organic[1];
    const style = inline ?? styles.get(url) ?? node;
    if (seen.has(url) && url) return 'unknown';
    if (url) seen.add(url);
    if (localName(style) === 'StyleMap') {
      const pairs = style.children.filter((n) => localName(n) === 'Pair');
      const normal = pairs.find((n) => value(n, 'key') === 'normal') ?? pairs[0];
      return normal ? colorOf(normal, seen) : 'unknown';
    }
    const icon = child(style, 'IconStyle');
    const href = icon ? value(child(icon, 'Icon') ?? icon, 'href') : '';
    const iconColor = /placemark-([a-z]+)(?:\.|$)/.exec(href)?.[1];
    const abgr = icon ? value(icon, 'color').toLowerCase() : '';
    return iconColor ?? (abgr || 'unknown');
  };
  const points: JourneyWaypoint[] = [];
  const collections = new Set<string>();
  const visit = (node: XmlNode, names: string[]) => {
    const tag = localName(node);
    if (tag === 'Document' || tag === 'Folder') { const name = value(node, 'name'); if (name) names = [...names, name]; }
    if ((tag === 'Document' || tag === 'Folder') && !node.children.some((c) => ['Document', 'Folder'].includes(localName(c)))) collections.add(names.join(' / ') || fileName);
    if (tag === 'Placemark') {
      for (const geometry of descendants(node, 'Point')) {
        const p = coord(value(geometry, 'coordinates'), /,/);
        if (!p) continue;
        const color = colorOf(node), semantics = organic ? WAYPOINT_COLOR_SEMANTICS[color] : undefined;
        const timestamp = child(node, 'TimeStamp');
        const markedAt = timestamp ? parseTime(value(timestamp, 'when')) : undefined;
        const collection = names.join(' / ') || fileName;
        collections.add(collection);
        points.push({ lat: p.lat, lon: p.lon, name: value(node, 'name'), color,
          kind: semantics?.kind ?? 'unknown', confidence: semantics?.confidence ?? 'unknown',
          ...(markedAt === undefined ? {} : { markedAt }), source: { file: fileName, collection }, duplicates: 0 });
      }
    }
    for (const c of node.children) visit(c, names);
  };
  visit(root, []);
  // Point в файле с треком — подписи на треке, а не замена его геометрии.
  track.waypoints = points.map(({ lat, lon, name }) => ({ lat, lon, name }));
  const index = links.length > 0 && descendants(root, 'Placemark').length === 0;
  track.kmlImport = { points, lines: descendants(root, 'LineString').length + descendants(root, 'Track').length, index, organic,
    collections: index ? [] : [...collections],
    content: points.length > 0 || track.segments.length > 0 };
  return { track, warnings: [] };
}

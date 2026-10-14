// Выбор парсера: по расширению, затем по содержимому.
import type { ParseResult, RawTrack } from '../types';
import { parseCsv, looksLikeCsv } from './csv';
import { ROUTE_ERRORS, RouteParseError } from './errors';
import { looksLikeJson, parseGeoJson } from './geojson';
import { looksLikeGpx, parseGpx } from './gpx';
import { looksLikeKml, parseKml } from './kml';
import { parseWaypointSample } from './waypoint-sample';
import { summarizeKmlImport } from './waypoints';

type Kind = 'gpx' | 'geojson' | 'csv' | 'kml';

const BY_EXT: Record<string, Kind> = { gpx: 'gpx', geojson: 'geojson', json: 'geojson', csv: 'csv', kml: 'kml' };
// известные чужие форматы — сразу «не поддерживается», без попыток угадать
const FOREIGN_EXT = new Set([
  'fit', 'tcx', 'igc', 'plt', 'nmea', 'ovl', 'gdb', 'shp', 'zip', 'gz', 'xls', 'xlsx', 'ods',
  'pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'mp4', 'mov',
]);

function extOf(fileName: string): string {
  const m = /\.([^./\\]+)$/.exec(fileName);
  return m ? m[1].toLowerCase() : '';
}

function sniff(text: string): Kind | null {
  const head = text.trimStart();
  if (head.startsWith('<')) return looksLikeGpx(head) ? 'gpx' : looksLikeKml(head) ? 'kml' : null;
  if (looksLikeJson(head)) return 'geojson';
  if (looksLikeCsv(head)) return 'csv';
  return null;
}

export function parseRouteText(fileName: string, text: string): ParseResult {
  const ext = extOf(fileName);
  if (ext === 'kmz') return { ok: false, error: ROUTE_ERRORS.unreadable('KMZ — архив; выберите исходный файл, а не его текст') };
  if (FOREIGN_EXT.has(ext)) return { ok: false, error: ROUTE_ERRORS.unsupported };
  const body = text.replace(/^﻿/, '');
  if (!body.trim()) return { ok: false, error: ROUTE_ERRORS.empty };

  const kind = BY_EXT[ext] ?? sniff(body);
  if (!kind) return { ok: false, error: ROUTE_ERRORS.unsupported };
  if (body.slice(0, 2048).includes('\u0000')) {
    return { ok: false, error: ROUTE_ERRORS.unreadable('это двоичный файл, а не текст') };
  }

  let parsed: { track: RawTrack; warnings: string[] };
  try {
    parsed = kind === 'gpx' ? parseGpx(fileName, body) : kind === 'kml' ? parseKml(fileName, body)
      : kind === 'geojson' ? (parseWaypointSample(fileName, body) ?? parseGeoJson(fileName, body)) : parseCsv(fileName, body);
  } catch (e) {
    if (e instanceof RouteParseError) return { ok: false, error: e.message };
    return { ok: false, error: ROUTE_ERRORS.unreadable(e instanceof Error ? e.message : String(e)) };
  }

  const pointCount = parsed.track.segments.reduce((n, s) => n + s.length, 0) + (parsed.track.kmlImport?.points.length ?? 0);
  if (!pointCount) return { ok: false, error: ROUTE_ERRORS.empty };
  return { ok: true, tracks: [parsed.track], warnings: parsed.warnings,
    ...(kind === 'kml' ? { report: summarizeKmlImport([parsed.track]).report } : {}) };
}

import type { RawTrack, Route } from '../types';
import { buildRoute } from './build';
import { buildWaypointRoute, summarizeKmlImport } from './waypoints';

export type ImportKind = 'track' | 'waypoints';
export interface RouteImportChoice { track: Route; waypoints: Route; selected: ImportKind }
// Десять отобранных уникальных меток-ночёвок — признак поездки в смешанном бэкапе Organic Maps.
// Это порог выбора представления, а не подтверждение визитов или количества ночей.
export const ORGANIC_TRIP_OVERNIGHT_THRESHOLD = 10;

export function createImportChoice(tracks: RawTrack[]): RouteImportChoice | null {
  if (!tracks.length || tracks.some((t) => !t.kmlImport) || !tracks.some((t) => t.kmlImport?.organic) ||
    !tracks.some((t) => t.segments.some((s) => s.length >= 2))) return null;
  const { selected } = summarizeKmlImport(tracks);
  if (selected.length < 2) return null;
  const track = buildRoute(tracks), waypoints = buildWaypointRoute(tracks);
  if ('error' in track || 'error' in waypoints) return null;
  const nights = selected.filter((p) => p.kind === 'overnight' && p.confidence === 'stated').length;
  return { track, waypoints, selected: nights >= ORGANIC_TRIP_OVERNIGHT_THRESHOLD ? 'waypoints' : 'track' };
}

// Синтетика «маршрута по меткам» (никаких настоящих координат путешественника): цепочки меток на параллели,
// собираются настоящим buildRoute из JourneyWaypoint — так форма Route совпадает с боевой (source.kind = 'waypoints').
import { buildRoute } from '../../src/route';
import type { EvidenceConfidence, JourneyWaypoint, Route, WaypointKind } from '../../src/types';
import { ok } from './fixtures';

export const DAY = 86_400_000;
export const D0 = Date.UTC(2025, 5, 1, 12, 0, 0);

const COLOR: Record<WaypointKind, string> = { overnight: 'green', train: 'yellow', stop: 'red', unknown: 'blue' };
const CONFIDENCE: Record<WaypointKind, EvidenceConfidence> = { overnight: 'stated', train: 'stated', stop: 'unknown', unknown: 'unknown' };

/** Метка: markedAt — день от D0 (undefined — без времени). */
export function jw(lat: number, lon: number, kind: WaypointKind, day?: number): JourneyWaypoint {
  return {
    lat, lon, name: '', kind, color: COLOR[kind], confidence: CONFIDENCE[kind],
    markedAt: day === undefined ? undefined : D0 + day * DAY,
    source: { file: 'synthetic', collection: 'synthetic' }, duplicates: 0,
  };
}

/** Route из меток: через настоящий buildRoute (organic: false — отбор по цветам и периоду не применяется). */
export function waypointRoute(points: JourneyWaypoint[]): Route {
  return ok(buildRoute([{
    sourceFile: 'synthetic.kml', segments: [], waypoints: [],
    kmlImport: { points, lines: 0, content: true, index: false, organic: false, collections: ['synthetic'] },
  }]));
}

/** Фикстура именно подтверждённой последовательности; основной импорт остаётся обзором. */
export function confirmedWaypointRoute(points: JourneyWaypoint[]): Route {
  return { ...waypointRoute(points), waypointOrderConfirmed: true };
}

/**
 * Синтетическая поездка по меткам (всё на 40–44° с. ш., долготы 30…110°):
 *  - 0…39: 40 ночёвок на параллели 40° с шагом 0,35° (≈ 30 км) по одной в день → уницикл (inferred);
 *  - 40: скачок на 25° за 2 дня (ночёвка → ночёвка, тысячи км) → unknown;
 *  - 41…45: пять жёлтых меток (поезд) через 3° по долготе в день;
 *  - 46…65: 20 ночёвок с шагом 0,4° и красными остановками после каждой пятой (всего 4).
 */
export function syntheticJourney(): JourneyWaypoint[] {
  const out: JourneyWaypoint[] = [];
  let day = 0;
  for (let i = 0; i < 40; i++) out.push(jw(40, 30 + i * 0.35, 'overnight', day++));
  day += 1; // сутки пропущены
  let lon = 30 + 39 * 0.35 + 25;
  out.push(jw(41, lon, 'overnight', day++));
  for (let i = 0; i < 5; i++) { lon += 3; out.push(jw(42, lon, 'train', day++)); }
  for (let i = 0; i < 20; i++) {
    lon += 0.4;
    out.push(jw(43, lon, 'overnight', day++));
    if (i % 5 === 4) out.push(jw(43.05, lon + 0.02, 'stop', day));
  }
  return out;
}

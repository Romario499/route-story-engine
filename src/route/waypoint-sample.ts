// Огрублённая выборка участка по меткам — JSON, который пишет scripts/waypoints-sample.mjs (ADR 0010).
// Читается тем же импортом, что KML: даёт RawTrack с kmlImport, дальше — обычный buildRoute → маршрут по меткам.
// Выборка уже отобрана (участок, страна, сетка 0,1°, без последних 90 дней), поэтому «семя» Organic Maps
// (первая зелёная метка в рамке Турции) к ней не применяется: старт — самая ранняя метка участка.
import type { EvidenceConfidence, JourneyWaypoint, RawTrack, WaypointKind } from '../types';

const KINDS: readonly WaypointKind[] = ['overnight', 'train', 'stop', 'unknown'];
const CONFIDENCE: readonly EvidenceConfidence[] = ['stated', 'inferred', 'unknown'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Разобрать выборку; `null`, если это не она (тогда файл читается как обычный GeoJSON). */
export function parseWaypointSample(fileName: string, text: string): { track: RawTrack; warnings: string[] } | null {
  if (!text.includes('"waypoints"')) return null; // дешёвая проверка до полного разбора большого GeoJSON
  let root: unknown;
  try { root = JSON.parse(text); } catch { return null; }
  if (!isObj(root) || !isObj(root.source) || root.source.kind !== 'waypoints' || !Array.isArray(root.waypoints)) return null;

  const points: JourneyWaypoint[] = [];
  let skipped = 0;
  for (const raw of root.waypoints) {
    if (!isObj(raw) || typeof raw.lat !== 'number' || typeof raw.lon !== 'number'
      || !(Math.abs(raw.lat) <= 90) || !(Math.abs(raw.lon) <= 180)) { skipped++; continue; }
    const kind = KINDS.find((k) => k === raw.kind) ?? 'unknown';
    const confidence = CONFIDENCE.find((c) => c === raw.confidence) ?? 'unknown';
    const source = isObj(raw.source) && typeof raw.source.collection === 'string' ? raw.source.collection : 'collection';
    points.push({
      lat: raw.lat, lon: raw.lon, name: '', // названий в огрублённой выборке нет намеренно: они могут раскрыть адрес
      markedAt: typeof raw.markedAt === 'number' && Number.isFinite(raw.markedAt) ? raw.markedAt : undefined,
      color: typeof raw.color === 'string' ? raw.color : 'unknown', kind, confidence,
      source: { file: source, collection: source }, duplicates: typeof raw.duplicates === 'number' ? raw.duplicates : 0,
    });
  }
  const collections = [...new Set(points.map((p) => p.source.collection))];
  const warnings = skipped ? [`Пропущено меток с некорректными координатами: ${skipped}`] : [];
  // organic: false — отбор по цвету и «семени» не применяется, все метки выборки идут в маршрут
  return { track: { sourceFile: fileName, segments: [], waypoints: [], kmlImport: { points, lines: 0, content: true, index: false, organic: false, collections } }, warnings };
}

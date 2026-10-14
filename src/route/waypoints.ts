import type { EvidenceConfidence, JourneyWaypoint, RawTrack, Route, WaypointImportReport, WaypointKind, WaypointSelection } from '../types';
import { ROUTE_ERRORS } from './errors';
import { buildWaypointLegReport } from '../story/legs';

// Источник: 2026-10-11-brief.md, последнее Дополнение — объяснение Шаха о метках @wahrier.
// stated подтверждает семантику цвета со слов владельца, а не визит/точную дату каждой ночёвки.
// Применяется только к распознанным Organic Maps; произвольные KML остаются unknown/unknown.
export const WAYPOINT_COLOR_SEMANTICS: Readonly<Record<string, { kind: WaypointKind; confidence: EvidenceConfidence }>> = {
  green: { kind: 'overnight', confidence: 'stated' }, lime: { kind: 'overnight', confidence: 'stated' },
  yellow: { kind: 'train', confidence: 'stated' }, red: { kind: 'stop', confidence: 'unknown' },
};
const keyOf = (p: JourneyWaypoint) => JSON.stringify([p.name, Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6)), p.markedAt ?? null]);
export const waypointCollectionKey = (source: JourneyWaypoint['source']): string => JSON.stringify([source.file, source.collection]);

export function summarizeKmlImport(tracks: RawTrack[], period: WaypointSelection = {}): {
  all: JourneyWaypoint[]; selected: JourneyWaypoint[]; report: WaypointImportReport;
} {
  const unique = new Map<string, JourneyWaypoint>();
  const collections = new Map<string, { file: string; collection: string; total: number; keys: Set<string> }>();
  let total = 0, lines = 0, kmlFiles = 0;
  for (const track of tracks) {
    const data = track.kmlImport;
    if (!data) continue;
    lines += data.lines; if (!data.index) kmlFiles++;
    for (const collection of data.collections) {
      const source = { file: track.sourceFile, collection }, key = JSON.stringify(source);
      if (!collections.has(key)) collections.set(key, { ...source, total: 0, keys: new Set() });
    }
    for (const p of data.points) {
      total++;
      const key = keyOf(p), ckey = JSON.stringify(p.source);
      let c = collections.get(ckey);
      if (!c) { c = { ...p.source, total: 0, keys: new Set() }; collections.set(ckey, c); }
      c.total++; c.keys.add(key);
      const existing = unique.get(key);
      if (existing) {
        existing.duplicates++;
        if (!existing.sources!.some(s => waypointCollectionKey(s) === waypointCollectionKey(p.source))) existing.sources!.push({ ...p.source });
        // Конфликт цвета у технических дублей нельзя автоматически объявить подтверждённым событием.
        if (existing.kind !== p.kind) { existing.kind = 'unknown'; existing.confidence = 'unknown'; }
      } else unique.set(key, { ...p, source: { ...p.source }, sources: [{ ...p.source }] });
    }
  }
  // Единственный порядок последовательности — время создания закладок, не даты визитов.
  // Стабильная сортировка сохраняет порядок равных дат и недатированных меток (они в конце).
  const all = [...unique.values()].sort((a, b) => {
    if (a.markedAt === undefined) return b.markedAt === undefined ? 0 : 1;
    if (b.markedAt === undefined) return -1;
    return a.markedAt - b.markedAt;
  });
  // G99: полный импорт без скрытого «семени», отбора по цвету, давности или географии.
  const from = period.from ?? -Infinity, to = period.to ?? Infinity;
  const inSegment = all.filter((p) => {
    if (period.collections && !p.sources!.some(s => period.collections!.includes(waypointCollectionKey(s)))) return false;
    return p.markedAt === undefined ? period.includeUndated !== false : p.markedAt >= from && p.markedAt <= to;
  });
  const organicFiles = new Set(tracks.filter(t => t.kmlImport?.organic).map(t => t.sourceFile));
  const otherColor = (p: JourneyWaypoint) => p.sources!.some(s => organicFiles.has(s.file))
    && (!WAYPOINT_COLOR_SEMANTICS[p.color] || p.kind !== WAYPOINT_COLOR_SEMANTICS[p.color].kind);
  const excludedOtherColors = period.includeOtherColors ? 0 : inSegment.filter(otherColor).length;
  const selected = period.includeOtherColors ? inSegment : inSegment.filter(p => !otherColor(p));
  return { all, selected, report: { total, unique: all.length, duplicates: total - all.length,
    included: selected.length, excludedPersonal: all.length - selected.length, excludedOtherColors, lines, kmlFiles,
    legs: buildWaypointLegReport(selected),
    collections: [...collections.values()].map(({ file, collection, total, keys }) => ({ file, collection, total, unique: keys.size })) } };
}

export function buildWaypointRoute(tracks: RawTrack[], selection: WaypointSelection = {}): Route | { error: string } {
  if (tracks.some((t) => !t.kmlImport && t.segments.some((s) => s.length))) return { error: ROUTE_ERRORS.unreadable('метки и GPS-трек нужно импортировать отдельно') };
  const { selected, report } = summarizeKmlImport(tracks, selection);
  if (!selected.length) return { error: ROUTE_ERRORS.empty };
  if (selected.length < 2) return { error: ROUTE_ERRORS.tooFew };
  for (let i = 1; i < selected.length; i++) if (Math.abs(selected[i].lon - selected[i - 1].lon) > 180) return { error: ROUTE_ERRORS.antimeridian };
  const bbox: Route['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of selected) { bbox[0] = Math.min(bbox[0], p.lon); bbox[1] = Math.min(bbox[1], p.lat); bbox[2] = Math.max(bbox[2], p.lon); bbox[3] = Math.max(bbox[3], p.lat); }
  return { source: { kind: 'waypoints' }, journeyWaypoints: selected, importReport: report,
    points: selected.map((p) => ({ lat: p.lat, lon: p.lon, d: 0, seg: 0, transferBefore: false })),
    waypointOrderConfirmed: selection.waypointOrderConfirmed === true,
    display: selected.map((_, i) => i), waypoints: selected.map((p, idx) => ({ ...p, idx })),
    totalM: 0, ownM: 0, transfers: [], hasTime: false, hasEle: false, bbox, name: tracks.find((t) => t.name)?.name };
}

// Выбор Organic Maps: охват >90 суток, несколько ночёвочных коллекций или <2 осмысленных меток при наличии других цветов.
export const WAYPOINT_ARCHIVE_SPAN_DAYS = 90;
export function requiresWaypointSelection(tracks: RawTrack[]): boolean {
  if (!tracks.some(t => t.kmlImport?.organic)) return false;
  const { all, selected, report } = summarizeKmlImport(tracks);
  const dates = all.flatMap(p => p.markedAt === undefined ? [] : [p.markedAt]);
  const collections = new Set(all.filter(p => p.kind === 'overnight').flatMap(p => p.sources!.map(waypointCollectionKey)));
  return collections.size > 1 || (dates.length > 0 && Math.max(...dates) - Math.min(...dates) > WAYPOINT_ARCHIVE_SPAN_DAYS * 86400000)
    || (all.length >= 2 && selected.length < 2 && (report.excludedOtherColors ?? 0) > 0);
}

// Маршрут по меткам (ADR 0010): участки между соседними метками, вид передвижения и честные показатели.
// Чистый модуль. Никакого километража трека, скорости и дорог: из меток известно только «где» и «когда поставлена закладка».
//   train    — хотя бы один конец участка — жёлтая метка (поезд, со слов путешественника);
//   unknown  — всё остальное; даты закладок не доказывают дни движения или уницикл.
// Диапазоны участков хранятся индексами меток (fromIdx..toIdx): по ним позже можно вырезать участок или страну (история 151).
import type { CameraState, Country, Enrichment, EvidenceConfidence, JourneyLeg, JourneyWaypoint, LegKind, Place, Route, TransportChange, ViewSize, WaypointLegReport } from '../types';
import { mercX, mercY, TILE_SIZE } from './mercator';

export interface OverviewLabels { countries: Country[]; country: Country | null; place: Place | null }

/**
 * Обзор T23 всегда плоский, север сверху: видимость — центр метки внутри полного viewport в Меркаторе.
 * Одна известная страна — её плашка и placeAt ближайшей к центру ВИДИМОЙ метки; несколько — группа без города.
 * Неизвестная страна у видимой метки запрещает утверждать единственную страну; пустой кадр не получает плашки.
 */
export function overviewLabels(route: Route, enrichment: Enrichment | null, camera: CameraState, viewport: ViewSize): OverviewLabels {
  const countries = new Map<string, Country>();
  const world = TILE_SIZE * 2 ** camera.zoom;
  const cx = mercX(camera.center[0]), cy = mercY(camera.center[1]);
  let nearest = -1, best = Infinity, unknown = false;
  route.points.forEach((p, i) => {
    const dx = (mercX(p.lon) - cx) * world, dy = (mercY(p.lat) - cy) * world;
    if (Math.abs(dx) > viewport.width / 2 || Math.abs(dy) > viewport.height / 2) return;
    const country = enrichment?.countryAt(i);
    if (country) countries.set(country.iso2, country); else unknown = true;
    const distance = dx * dx + dy * dy;
    if (distance < best) { best = distance; nearest = i; }
  });
  const visible = [...countries.values()];
  const country = visible.length === 1 && !unknown ? visible[0] : null;
  return { countries: visible, country, place: country && nearest >= 0 ? enrichment?.placeAt(nearest) ?? null : null };
}

/** Географический перечень, не порядок визитов: долгота центроида всех меток страны; равные — по ISO. */
export function overviewCountries(route: Route, enrichment: Enrichment | null): Country[] {
  const groups = new Map<string, { country: Country; sumLon: number; count: number }>();
  route.points.forEach((p, i) => {
    const country = enrichment?.countryAt(i);
    if (!country) return;
    const group = groups.get(country.iso2) ?? { country, sumLon: 0, count: 0 };
    group.sumLon += p.lon; group.count++;
    groups.set(country.iso2, group);
  });
  return [...groups.values()].sort((a, b) => a.sumLon / a.count - b.sumLon / b.count
    || a.country.iso2.localeCompare(b.country.iso2)).map(g => g.country);
}

/** @deprecated Старый порог сохраняет интерфейс T19; из дат закладок транспорт больше не выводится. */
export const UNICYCLE_MAX_KM_PER_DAY = 120;
const EARTH_R_KM = 6371.0088;

export function isWaypointRoute(route: Route): boolean {
  return route.source?.kind === 'waypoints' && (route.journeyWaypoints?.length ?? 0) > 0;
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Схематические связи меток. Семантика поездной метки сохраняется со слов владельца;
 * даты закладок не используются для определения транспорта или скорости.
 */
export function buildLegs(route: Pick<Route, 'journeyWaypoints'>, opts: { maxKmPerDay?: number } = {}): JourneyLeg[] {
  const marks = route.journeyWaypoints ?? [];
  void opts; // старый контракт сохранён; даты закладок больше не используются для вывода транспорта.
  const legs: JourneyLeg[] = [];
  for (let i = 0; i + 1 < marks.length; i++) {
    const a = marks[i], b = marks[i + 1];
    const straightKm = haversineKm(a.lat, a.lon, b.lat, b.lon);
    let kind: LegKind = 'unknown';
    let confidence: EvidenceConfidence = 'unknown';
    if (a.kind === 'train' || b.kind === 'train') {
      kind = 'train';
      confidence = (a.kind === 'train' ? a.confidence : b.confidence) === 'stated' ? 'stated' : 'inferred';
    }
    legs.push({ fromIdx: i, toIdx: i + 1, kind, confidence, straightKm });
  }
  return legs;
}

/** Серия подряд идущих участков одного вида. */
export interface TransportRun extends TransportChange { legCount: number }

export function runsOf(legs: JourneyLeg[]): TransportRun[] {
  const runs: TransportRun[] = [];
  for (const leg of legs) {
    const last = runs[runs.length - 1];
    if (last && last.kind === leg.kind) {
      last.toIdx = leg.toIdx; last.legCount++;
      if (leg.confidence === 'unknown' || (leg.confidence === 'inferred' && last.confidence === 'stated')) last.confidence = leg.confidence;
      continue;
    }
    runs.push({ kind: leg.kind, confidence: leg.confidence, fromIdx: leg.fromIdx, toIdx: leg.toIdx, legCount: 1 });
  }
  return runs;
}

/** Таблица участков отчёта импорта: одна классификация для отчёта и кадра. */
export function buildWaypointLegReport(marks: JourneyWaypoint[], opts: { maxKmPerDay?: number } = {}): WaypointLegReport[] {
  return runsOf(buildLegs({ journeyWaypoints: marks }, opts)).map(({ legCount: _count, ...run }) => ({
    ...run, waypointCount: run.toIdx - run.fromIdx + 1,
  }));
}

export interface JourneyFacts {
  legs: JourneyLeg[];
  runs: TransportRun[];
  /** Число различных мест меток-ночёвок среди меток 0..i; НЕ число ночей. */
  nights: Int32Array;
  nightsTotal: number;
  /** @deprecated Всегда отсутствует: создание закладки не определяет день поездки. */
  markDays?: Uint16Array;
  /** @deprecated Всегда отсутствует: даты закладок не определяют длительность поездки. */
  days?: number;
  /** Накопленные расстояния между закладками для темпа и камеры; не длина и не нижняя граница пути. */
  straightKm: Float64Array;
  straightTotalKm: number;
}

const cache = new WeakMap<Route, JourneyFacts>();

/**
 * Факты о метках; null для GPS. Места ночёвок различаются координатами до 1e-6, без пространственного укрупнения.
 * Время создания закладки не определяет ни день поездки, ни число ночей, ни способ передвижения.
 */
export function journeyFacts(route: Route): JourneyFacts | null {
  if (!isWaypointRoute(route)) return null;
  const hit = cache.get(route);
  if (hit) return hit;
  const marks = route.journeyWaypoints ?? [];
  const n = marks.length;
  const legs = buildLegs(route);
  const nights = new Int32Array(n);
  const straightKm = new Float64Array(n);
  const places = new Set<string>();
  for (let i = 0; i < n; i++) {
    if (marks[i].kind === 'overnight') places.add(`${marks[i].lat.toFixed(6)},${marks[i].lon.toFixed(6)}`);
    nights[i] = places.size;
    straightKm[i] = i > 0 ? straightKm[i - 1] + legs[i - 1].straightKm : 0;
  }
  const facts: JourneyFacts = {
    legs, runs: runsOf(legs), nights, nightsTotal: n ? nights[n - 1] : 0,
    straightKm, straightTotalKm: n ? straightKm[n - 1] : 0,
  };
  cache.set(route, facts);
  return facts;
}

/** Факты в дробном индексе головы: ночёвки, день по меткам; straightKm — только для темпа/камеры. */
export function factsAt(facts: JourneyFacts, head: number): { nights: number; day?: number; straightKm: number } {
  const last = facts.nights.length - 1;
  const i = Math.max(0, Math.min(last, Math.floor(head)));
  const j = Math.min(last, i + 1);
  const f = Math.max(0, Math.min(1, head - i));
  return {
    nights: facts.nights[i],
    day: facts.markDays ? facts.markDays[i] : undefined,
    straightKm: facts.straightKm[i] + (facts.straightKm[j] - facts.straightKm[i]) * f,
  };
}

/**
 * Стоимость скачка в темпе по меткам: как у переезда трека (в 4 раза быстрее своего хода), но без потолка — иначе скачок на тысячи
 * км пролетает за кадр. Камера на таком скачке поднимается (до 1,5 уровня зума), поэтому скорость на экране остаётся ≈ 1,5 крейсерской.
 */
export const WAYPOINT_TRANSFER_COST = { factor: 0.25, capShare: 1000 } as const;
/** Скачок длиннее стольких ширин окна путешествия движется как «переезд»: короче — обычным ходом (камера успевает без подъёма). */
export const HOP_VIEW_RATIO = 2.6;

/**
 * Маршрут для темпа и камеры: те же точки, но с накопленной «длиной по прямой» в `d`; скачки длиннее hopLimitKm — переезды
 * (быстрее, камера выше). Поезд — обычный ход по длине участка. Только для расчёта темпа/камеры — километражем не показывается.
 */
export function waypointPacingRoute(route: Route, facts: JourneyFacts, hopLimitKm = Infinity): Route {
  const transfers: Route['transfers'] = [];
  let ownM = 0;
  const points = route.points.map((p, i) => {
    const leg = i > 0 ? facts.legs[i - 1] : null;
    const transferBefore = leg !== null && leg.straightKm > hopLimitKm;
    if (transferBefore) transfers.push({ fromIdx: i - 1, toIdx: i });
    else if (leg) ownM += leg.straightKm * 1000;
    return { ...p, d: facts.straightKm[i] * 1000, seg: transfers.length, transferBefore };
  });
  return { ...route, points, transfers, totalM: facts.straightTotalKm * 1000, ownM };
}

// Из сырых треков — очищенный маршрут со статистикой (склейка, выбросы, переезды, дни, скорость, высоты, упрощение).
import type { RawTrack, Route, RoutePoint, TrackPoint, Waypoint } from '../types';
import { ROUTE_ERRORS } from './errors';
import { haversineM, mercatorX, mercatorY } from './geo-math';
import { simplifyIndices } from './simplify';
import { buildWaypointRoute } from './waypoints';

const OUTLIER_KMH = 400;          // одиночный «прыжок» быстрее этого — выброс
const TRANSFER_M = 30_000;        // скачок длиннее этого — кандидат в переезды…
const TRANSFER_STEP_RATIO = 5;    // …если он > 5× медианного шага файла…
const TRANSFER_PACE_RATIO = 3;    // …и (при наличии времени) скорость на нём в 3+ раза выше или ниже темпа файла
const SPEED_WINDOW_MS = 10 * 60_000; // окно сглаживания скорости
const STOP_KMH = 1.5;             // медленнее — стоянка, скорость не показываем
const JITTER_M = 15;              // сдвиг от опорной точки меньше этого — дрожание GPS: километры не растут
const GAIN_THRESHOLD_M = 5;       // подъём меньше этого — шум высотомера
const DISPLAY_MAX = 6000;         // точек в упрощённой линии для отрисовки
const WAYPOINT_MAX_SHARE = 0.02;  // остановка не дальше 2% длины маршрута от трека
const TIME_SHARE = 0.95;          // столько точек должно иметь время, чтобы маршрут считался «со временем»
const ELE_SHARE = 0.9;            // то же для высоты
const DAY_MS = 86_400_000;

const validCoord = (p: TrackPoint) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
  Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && !(p.lat === 0 && p.lon === 0);

const samePoint = (a: TrackPoint, b: TrackPoint) => a.lat === b.lat && a.lon === b.lon && a.time === b.time;

/** Скорость a→b в км/ч; Infinity, если время не идёт вперёд, а расстояние есть. */
function kmh(a: TrackPoint, b: TrackPoint, dist: number): number {
  const dt = (b.time as number) - (a.time as number);
  if (dt <= 0) return dist > 0 ? Infinity : 0;
  return (dist * 3600) / dt;
}

/** Одиночный выброс: и до него, и от него > 400 км/ч, а соседи рядом друг с другом (точка «прыгнула и вернулась»). */
function isSpike(prev: TrackPoint, c: TrackPoint, next: TrackPoint): boolean {
  if (prev.time === undefined || c.time === undefined || next.time === undefined) return false;
  const d1 = haversineM(prev.lat, prev.lon, c.lat, c.lon);
  const d2 = haversineM(c.lat, c.lon, next.lat, next.lon);
  if (kmh(prev, c, d1) <= OUTLIER_KMH || kmh(c, next, d2) <= OUTLIER_KMH) return false;
  return haversineM(prev.lat, prev.lon, next.lat, next.lon) < 0.5 * Math.min(d1, d2);
}

/** Точки одного файла: только валидные, без дублей и одиночных выбросов. */
function cleanTrack(points: TrackPoint[]): TrackPoint[] {
  const deduped: TrackPoint[] = [];
  for (const p of points) {
    const last = deduped[deduped.length - 1];
    if (!last || !samePoint(last, p)) deduped.push(p);
  }
  const out: TrackPoint[] = [];
  for (let i = 0; i < deduped.length; i++) {
    const prev = out[out.length - 1];
    const next = deduped[i + 1];
    if (prev && next && isSpike(prev, deduped[i], next)) continue;
    out.push(deduped[i]);
  }
  return out;
}

interface Pace { medStepM: number; medKmh?: number }

function median(values: number[]): number {
  if (!values.length) return 0;
  const a = Float64Array.from(values).sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Обычный шаг и темп файла: медианы по ненулевым шагам. */
function filePace(pts: TrackPoint[]): Pace {
  const steps: number[] = [];
  const speeds: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = haversineM(a.lat, a.lon, b.lat, b.lon);
    if (d <= 0) continue;
    steps.push(d);
    if (a.time !== undefined && b.time !== undefined && b.time > a.time) speeds.push(kmh(a, b, d));
  }
  const pace: Pace = { medStepM: median(steps) };
  if (speeds.length) pace.medKmh = median(speeds);
  return pace;
}

/** Разрыв внутри файла: > 30 км, > 5× обычного шага и (если есть время) не в темпе файла. */
function isGap(a: TrackPoint, b: TrackPoint, step: number, pace: Pace): boolean {
  if (step <= TRANSFER_M || step <= TRANSFER_STEP_RATIO * pace.medStepM) return false;
  if (pace.medKmh === undefined || !(pace.medKmh > 0) || a.time === undefined || b.time === undefined) return true;
  const v = kmh(a, b, step);
  return v > pace.medKmh * TRANSFER_PACE_RATIO || v < pace.medKmh / TRANSFER_PACE_RATIO;
}

export function buildRoute(tracks: RawTrack[]): Route | { error: string } {
  const hasSegments = tracks.some((t) => t.segments.some((s) => s.length >= 2));
  if (tracks.some((t) => t.kmlImport?.points.length && !t.segments.some((s) => s.length >= 2)) &&
    tracks.some((t) => !t.kmlImport && t.segments.some((s) => s.length))) {
    return { error: ROUTE_ERRORS.unreadable('метки и GPS-трек нужно импортировать отдельно') };
  }
  if (!hasSegments && tracks.some((t) => t.kmlImport?.points.length)) return buildWaypointRoute(tracks);
  // 1. валидные точки по файлам; решение «есть время / высота» — по всему маршруту
  const perTrack = tracks.map((t) => {
    const pts: TrackPoint[] = [];
    for (const seg of t.segments) {
      for (const p of seg) {
        if (!validCoord(p)) continue;
        const q: TrackPoint = { lat: p.lat, lon: p.lon };
        if (typeof p.ele === 'number' && Number.isFinite(p.ele)) q.ele = p.ele;
        if (typeof p.time === 'number' && Number.isFinite(p.time)) q.time = p.time;
        pts.push(q);
      }
    }
    return { track: t, pts };
  });
  let total = 0, timed = 0, withEle = 0;
  for (const { pts } of perTrack) {
    total += pts.length;
    for (const p of pts) {
      if (p.time !== undefined) timed++;
      if (p.ele !== undefined) withEle++;
    }
  }
  if (!total) return { error: ROUTE_ERRORS.empty };
  // маршрут через ±180° не поддерживаем: линия, карта и камера пойдут «вокруг света» — отклоняем до экспорта
  for (const { pts } of perTrack) {
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].lon - pts[i - 1].lon) > 180) return { error: ROUTE_ERRORS.antimeridian };
    }
  }
  const hasTime = timed / total >= TIME_SHARE;
  const hasEle = withEle / total >= ELE_SHARE;

  const cleaned = perTrack.map(({ track, pts }) => {
    let list = pts;
    if (hasTime) list = list.filter((p) => p.time !== undefined);
    else if (timed) list = list.map((p) => { const q = { ...p }; delete q.time; return q; });
    if (!hasEle && withEle) list = list.map((p) => { const q = { ...p }; delete q.ele; return q; });
    const clean = cleanTrack(list);
    return { track, pts: clean, pace: filePace(clean) };
  }).filter((t) => t.pts.length > 0);

  // 2. порядок файлов: по времени начала (если время есть), иначе как выбрали
  if (hasTime) cleaned.sort((a, b) => (a.pts[0].time as number) - (b.pts[0].time as number));

  // 3. склейка, расстояния, переезды
  const points: RoutePoint[] = [];
  const transfers: { fromIdx: number; toIdx: number }[] = [];
  let seg = 0, d = 0, ownM = 0;
  // Километры считаем от «опорной» точки: пока точка ближе JITTER_M к опорной — это дрожание GPS на месте,
  // d не растёт (иначе 30 минут стоянки с шумом ±4 м дали бы километры). Дошли дальше — опора переезжает сюда.
  let anchor: { lat: number; lon: number } | undefined;
  cleaned.forEach(({ pts, pace }, fileIdx) => {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = points[points.length - 1];
      if (prev && samePoint(prev, p)) continue;
      let transferBefore = false;
      if (prev) {
        const step = haversineM(prev.lat, prev.lon, p.lat, p.lon);
        transferBefore = i === 0 ? fileIdx > 0 : isGap(pts[i - 1], p, step, pace);
        if (transferBefore) {
          d += step;
          seg++;
          transfers.push({ fromIdx: points.length - 1, toIdx: points.length });
          anchor = p;
        } else if (anchor) {
          const move = haversineM(anchor.lat, anchor.lon, p.lat, p.lon);
          if (move >= JITTER_M) { d += move; ownM += move; anchor = p; }
        }
      } else {
        anchor = p;
      }
      const rp: RoutePoint = { lat: p.lat, lon: p.lon, d, seg, transferBefore };
      if (p.ele !== undefined) rp.ele = p.ele;
      if (p.time !== undefined) rp.time = p.time;
      points.push(rp);
    }
  });
  // хвост: последняя точка ближе JITTER_M к опорной — докладываем остаток, чтобы финиш не терял метры
  const lastPt = points[points.length - 1];
  if (lastPt && anchor && !lastPt.transferBefore && (anchor.lat !== lastPt.lat || anchor.lon !== lastPt.lon)) {
    const tail = haversineM(anchor.lat, anchor.lon, lastPt.lat, lastPt.lon);
    d += tail; ownM += tail; lastPt.d = d;
  }
  const n = points.length;
  if (n < 2 || d === 0) return { error: ROUTE_ERRORS.tooFew };

  // куски между переездами: [первый, последний] индекс
  const ranges: [number, number][] = [];
  let rangeStart = 0;
  for (let i = 1; i < n; i++) {
    if (points[i].transferBefore) { ranges.push([rangeStart, i - 1]); rangeStart = i; }
  }
  ranges.push([rangeStart, n - 1]);

  const route: Route = {
    points,
    display: [],
    totalM: d,
    ownM,
    transfers,
    hasTime,
    hasEle,
    bbox: [Infinity, Infinity, -Infinity, -Infinity],
    waypoints: [],
  };
  const name = cleaned.find((t) => t.track.name)?.track.name;
  if (name) route.name = name;

  // 4. рамка
  const bbox = route.bbox;
  for (const p of points) {
    if (p.lon < bbox[0]) bbox[0] = p.lon;
    if (p.lat < bbox[1]) bbox[1] = p.lat;
    if (p.lon > bbox[2]) bbox[2] = p.lon;
    if (p.lat > bbox[3]) bbox[3] = p.lat;
  }

  // 5. время: дни и скорость
  if (hasTime) fillTimeStats(route, ranges);

  // 6. высоты
  if (hasEle) fillEleStats(route);

  // 7. упрощённая линия для отрисовки
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = mercatorX(points[i].lon); ys[i] = mercatorY(points[i].lat); }
  route.display = simplifyIndices(xs, ys, ranges, DISPLAY_MAX);

  // 8. именованные остановки рядом с треком
  const wpts: Waypoint[] = [];
  for (const { track } of cleaned) for (const w of track.waypoints) if (validCoord(w) && w.name) wpts.push(w);
  route.waypoints = snapWaypoints(wpts, points, d * WAYPOINT_MAX_SHARE);

  return route;
}

// ПОЛИТИКА ДНЕЙ (одна на скорость, дни и даты в кадре; src/story/timeline.ts считает дату тем же сдвигом).
// «День» — календарный день по местному солнечному времени точки: UTC + round(долгота / 15) часов.
// route.day[i] = календарный день точки − календарный день первой точки + 1; назад день не откатывается
// (поездка на запад не «возвращает» дату). route.days = день последней точки = разница календарных дат + 1.
// Это календарные дни, а не длительность: 22:00 → 02:00 местного — 2 дня, 08:00 → 20:00 одной даты — 1 день,
// 08:00 → 08:00 следующей даты — 2 дня, хотя прошло ровно 24 часа.
const localDay = (t: number, lon: number) => Math.floor((t + Math.round(lon / 15) * 3_600_000) / DAY_MS);

function fillTimeStats(route: Route, ranges: [number, number][]): void {
  const pts = route.points;
  const n = pts.length;
  route.startTime = pts[0].time;
  route.endTime = pts[n - 1].time;

  const day = new Uint16Array(n);
  const base = localDay(pts[0].time as number, pts[0].lon);
  let cur = 1;
  for (let i = 0; i < n; i++) {
    const v = localDay(pts[i].time as number, pts[i].lon) - base + 1;
    if (v > cur) cur = Math.min(v, 65535);
    day[i] = cur;
  }
  route.day = day;
  route.days = day[n - 1];

  // окно по времени ±5 мин, внутри куска между переездами
  const speed = new Float32Array(n).fill(NaN);
  const half = SPEED_WINDOW_MS / 2;
  for (const [a, b] of ranges) {
    let lo = a, hi = a;
    for (let i = a; i <= b; i++) {
      const t = pts[i].time as number;
      while (lo < i && (pts[lo].time as number) < t - half) lo++;
      if (hi < i) hi = i;
      while (hi < b && (pts[hi + 1].time as number) <= t + half) hi++;
      let l = lo, h = hi;
      if (l === h) { l = Math.max(a, i - 1); h = Math.min(b, i + 1); }
      const dt = (pts[h].time as number) - (pts[l].time as number);
      if (dt <= 0) continue;
      // скорость — по смещению за окно, а не по сумме шагов: дрожание на стоянке не превращается в «скорость»
      const v = (haversineM(pts[l].lat, pts[l].lon, pts[h].lat, pts[h].lon) * 3600) / dt;
      if (v >= STOP_KMH) speed[i] = v;
    }
  }
  route.speedKmh = speed;
}

function fillEleStats(route: Route): void {
  const pts = route.points;
  // редкие точки без высоты — берём ближайшую известную слева (или первую известную)
  let lastKnown = pts.find((p) => p.ele !== undefined)?.ele as number;
  for (const p of pts) {
    if (p.ele === undefined) p.ele = lastKnown;
    else lastKnown = p.ele;
  }
  let max = { value: -Infinity, idx: 0 };
  let min = { value: Infinity, idx: 0 };
  let gain = 0;
  let ref = pts[0].ele as number;
  for (let i = 0; i < pts.length; i++) {
    const e = pts[i].ele as number;
    if (e > max.value) max = { value: e, idx: i };
    if (e < min.value) min = { value: e, idx: i };
    if (pts[i].transferBefore) { ref = e; continue; } // перепад на переезде (паром, перелёт) не считаем
    if (e >= ref + GAIN_THRESHOLD_M) { gain += e - ref; ref = e; }
    else if (e < ref) ref = e;
  }
  route.maxEle = max;
  route.minEle = min;
  route.gainM = gain;
}

function snapWaypoints(wpts: Waypoint[], pts: RoutePoint[], maxM: number): (Waypoint & { idx: number })[] {
  const out: (Waypoint & { idx: number })[] = [];
  const seen = new Set<string>();
  for (const w of wpts) {
    const k = Math.cos((w.lat * Math.PI) / 180);
    let best = -1, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dx = (pts[i].lon - w.lon) * k, dy = pts[i].lat - w.lat;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    if (best < 0) continue;
    const dist = haversineM(w.lat, w.lon, pts[best].lat, pts[best].lon);
    const key = `${w.name}|${best}`;
    if (dist > maxM || seen.has(key)) continue;
    seen.add(key);
    out.push({ lat: w.lat, lon: w.lon, name: w.name, idx: best });
  }
  return out.sort((a, b) => a.idx - b.idx);
}

// Офлайн-география: страна по точке (границы Natural Earth), ближайший город, сюжетные биты маршрута.
// Чистый модуль: без DOM, window, fetch. Загрузка JSON из public/data — в load.ts.
//
// Форматы файлов (их пишет scripts/build-geodata.mjs):
//   CountriesJson — public/data/countries.json
//     coords в целых 1/scale градуса; ring = [x0, y0, dx1, dy1, …] (дельта-кодирование, замыкающая точка не хранится);
//     polygon = [контур, дырка, дырка, …]; страна — один или несколько полигонов.
//   PlacesJson — public/data/places.json
//     places[i] = [nameRu, nameEn, lat, lon, pop], по убыванию pop.
//
// Биты (Enrichment.beats):
//   start  — idx 0 (с country и place);
//   country — на каждый въезд в страну, отличную от предыдущей посещённой (повторный въезд — тоже бит),
//             склеивается только «дрожание у границы»: кусок короче 15 км (прямая вход→выход; путь < 45 км), целиком в пределах 5 км от границы, между двумя
//             кусками одной и той же страны (глобального порога нет); реальный заезд вглубь соседней страны — даже
//             короткий, но дальше 5 км от границы, — остаётся визитом и даёт бит;
//             страна старта отдельного бита не получает — она в start;
//   peak   — высшая точка: только при route.hasEle, перепаде маршрута ≥ 300 м и пике ≥ медиана + 200 м
//             (на плоском городском треке шум высотомера не становится сюжетом);
//   waypoint — именованная остановка (label = имя); если она ближе 1 км вдоль маршрута к старту или финишу — не дублируем;
//   finish — последняя точка.
import type { Beat, Country, Enrichment, Place, Route } from '../types';
import { haversineM } from '../route/geo-math';

export interface CountriesJson {
  v: 1;
  scale: number;
  countries: {
    iso2: string;
    nameRu: string;
    nameEn: string;
    bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
    polygons: number[][][];
  }[];
}
export interface PlacesJson {
  v: 1;
  places: [nameRu: string, nameEn: string, lat: number, lon: number, pop: number][];
}

export interface GeoIndex {
  countryAt(lon: number, lat: number): Country | null;
  nearestPlace(lon: number, lat: number, maxKm: number): Place | null;
  /** Расстояние (м) от точки до контура страны; Infinity, если дальше maxM или страны нет в индексе. Без метода склейки у границы нет. */
  borderDistM?(lon: number, lat: number, country: Country, maxM: number): number;
}

/** Радиус поиска «ближайшего города» для привязки точек маршрута (км). */
export const PLACE_RADIUS_KM = 40;
/** Склеиваем только куски, чья протяжённость (прямая от входа до выхода) короче этого (м)… */
const BORDER_HUG_MAX_M = 15_000;
/** …и чей путь вдоль маршрута короче этого (м) — долгое блуждание у границы не прячем… */
const BORDER_HUG_PATH_MAX_M = 45_000;
/** …и целиком не дальше этого от границы (м): дрожание у границы или дорога вдоль неё. */
const BORDER_HUG_DIST_M = 5_000;
/** Высшая точка — только при перепаде высот маршрута не меньше этого (м)… */
export const PEAK_MIN_RANGE_M = 300;
/** …и если пик выше медианы высот не меньше чем на это (м). */
export const PEAK_ABOVE_MEDIAN_M = 200;
const M_PER_DEG = 111_195;
/** Точка вне полигонов, но ближе этого к берегу/границе, считается страной (грубая береговая линия 1:50m), градусы. */
const COAST_TOL_DEG = 0.05;
/** Остановка ближе этого к старту/финишу вдоль маршрута не получает отдельного бита (м). */
const WAYPOINT_DEDUP_M = 1000;

// --- страны: point-in-polygon ---

interface Poly {
  bbox: [number, number, number, number];
  rings: Float64Array[]; // lon, lat, lon, lat, …
}
interface CountryEntry {
  country: Country;
  bbox: [number, number, number, number];
  polys: Poly[];
}

function decodeRing(flat: number[], scale: number): Float64Array {
  const out = new Float64Array(flat.length);
  let x = 0, y = 0;
  for (let i = 0; i < flat.length; i += 2) {
    x = i === 0 ? flat[0] : x + flat[i];
    y = i === 0 ? flat[1] : y + flat[i + 1];
    out[i] = x / scale;
    out[i + 1] = y / scale;
  }
  return out;
}

function ringBBox(r: Float64Array): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < minX) minX = r[i];
    if (r[i] > maxX) maxX = r[i];
    if (r[i + 1] < minY) minY = r[i + 1];
    if (r[i + 1] > maxY) maxY = r[i + 1];
  }
  return [minX, minY, maxX, maxY];
}

/** Чётно-нечётное правило: точка внутри кольца? */
function inRing(r: Float64Array, lon: number, lat: number): boolean {
  let inside = false;
  const n = r.length;
  let jx = r[n - 2], jy = r[n - 1];
  for (let i = 0; i < n; i += 2) {
    const ix = r[i], iy = r[i + 1];
    if ((iy > lat) !== (jy > lat) && lon < ((jx - ix) * (lat - iy)) / (jy - iy) + ix) inside = !inside;
    jx = ix; jy = iy;
  }
  return inside;
}

function inEntry(e: CountryEntry, lon: number, lat: number): boolean {
  const b = e.bbox;
  if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) return false;
  for (const p of e.polys) {
    const pb = p.bbox;
    if (lon < pb[0] || lon > pb[2] || lat < pb[1] || lat > pb[3]) continue;
    // чётное число покрытий по всем кольцам: контур + дырки
    let hits = 0;
    for (const ring of p.rings) if (inRing(ring, lon, lat)) hits++;
    if (hits % 2 === 1) return true;
  }
  return false;
}

/** Расстояние (в градусах, с поправкой долготы на широту) от точки до ближайшего ребра кольца. */
function ringDistDeg(r: Float64Array, lon: number, lat: number, k: number): number {
  let best = Infinity;
  const n = r.length;
  let ax = r[n - 2], ay = r[n - 1];
  for (let i = 0; i < n; i += 2) {
    const bx = r[i], by = r[i + 1];
    const dx = (bx - ax) * k, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? (((lon - ax) * k) * dx + (lat - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = (lon - ax) * k - t * dx, ey = lat - ay - t * dy;
    const d = Math.hypot(ex, ey);
    if (d < best) best = d;
    ax = bx; ay = by;
  }
  return best;
}

/** Ближайшая страна не дальше COAST_TOL_DEG от контура (для точек у моря и на границе генерализованной карты). */
function nearestEntry(entries: CountryEntry[], lon: number, lat: number): CountryEntry | null {
  const tol = COAST_TOL_DEG;
  const k = Math.cos((lat * Math.PI) / 180);
  const tolLon = tol / Math.max(0.05, k);
  let best: CountryEntry | null = null;
  let bestD = tol;
  for (const e of entries) {
    const b = e.bbox;
    if (lon < b[0] - tolLon || lon > b[2] + tolLon || lat < b[1] - tol || lat > b[3] + tol) continue;
    for (const p of e.polys) {
      const pb = p.bbox;
      if (lon < pb[0] - tolLon || lon > pb[2] + tolLon || lat < pb[1] - tol || lat > pb[3] + tol) continue;
      const d = ringDistDeg(p.rings[0], lon, lat, k);
      if (d < bestD) { bestD = d; best = e; }
    }
  }
  return best;
}

// --- города: сетка 1° ---

const cellKey = (cx: number, cy: number) => cy * 1000 + cx; // cx в 0..359, cy в 0..179

export function createGeoIndex(countries: CountriesJson, places: PlacesJson): GeoIndex {
  const entries: CountryEntry[] = countries.countries.map((c) => ({
    country: { iso2: c.iso2, nameRu: c.nameRu, nameEn: c.nameEn },
    bbox: c.bbox,
    polys: c.polygons.map((rings) => {
      const decoded = rings.map((r) => decodeRing(r, countries.scale));
      return { bbox: ringBBox(decoded[0]), rings: decoded };
    }),
  }));

  let last: CountryEntry | null = null; // маршрут идёт подряд — чаще всего страна та же, что у предыдущей точки
  const countryAt = (lon: number, lat: number): Country | null => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (last && inEntry(last, lon, lat)) return last.country;
    for (const e of entries) {
      if (e !== last && inEntry(e, lon, lat)) { last = e; return e.country; }
    }
    const near = nearestEntry(entries, lon, lat);
    return near ? near.country : null;
  };

  const cells = new Map<number, Place[]>();
  const wrapX = (cx: number) => ((cx % 360) + 360) % 360;
  for (const [nameRu, nameEn, lat, lon, pop] of places.places) {
    const key = cellKey(wrapX(Math.floor(lon + 180)), Math.min(179, Math.max(0, Math.floor(lat + 90))));
    const list = cells.get(key);
    const place: Place = { nameRu, nameEn, lat, lon, pop };
    if (list) list.push(place);
    else cells.set(key, [place]);
  }

  const nearestPlace = (lon: number, lat: number, maxKm: number): Place | null => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !(maxKm > 0)) return null;
    const dy = Math.ceil(maxKm / 111) + 1;
    const cosLat = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const dx = Math.min(180, Math.ceil(maxKm / (111 * cosLat)) + 1);
    const cx0 = Math.floor(lon + 180), cy0 = Math.floor(lat + 90);
    let best: Place | null = null;
    let bestM = maxKm * 1000;
    for (let cy = Math.max(0, cy0 - dy); cy <= Math.min(179, cy0 + dy); cy++) {
      for (let cx = cx0 - dx; cx <= cx0 + dx; cx++) {
        const list = cells.get(cellKey(wrapX(cx), cy));
        if (!list) continue;
        for (const p of list) {
          const m = haversineM(lat, lon, p.lat, p.lon);
          if (m <= bestM) { bestM = m; best = p; }
        }
      }
    }
    return best;
  };

  const byCountry = new Map<string, CountryEntry>();
  for (const e of entries) byCountry.set(`${e.country.iso2}|${e.country.nameEn}`, e);

  const borderDistM = (lon: number, lat: number, country: Country, maxM: number): number => {
    const e = byCountry.get(`${country.iso2}|${country.nameEn}`);
    if (!e || !Number.isFinite(lon) || !Number.isFinite(lat)) return Infinity;
    const tol = maxM / M_PER_DEG;
    const k = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const tolLon = tol / k;
    let best = Infinity;
    for (const p of e.polys) {
      const pb = p.bbox;
      if (lon < pb[0] - tolLon || lon > pb[2] + tolLon || lat < pb[1] - tol || lat > pb[3] + tol) continue;
      for (const ring of p.rings) {
        const dm = ringDistDeg(ring, lon, lat, k) * M_PER_DEG;
        if (dm < best) best = dm;
      }
    }
    return best <= maxM ? best : Infinity;
  };

  return { countryAt, nearestPlace, borderDistM };
}

// --- обогащение маршрута ---

interface Run { fromIdx: number; toIdx: number; country: Country | null }

const sameCountry = (a: Country | null, b: Country | null): boolean =>
  a === b || (a !== null && b !== null && a.iso2 === b.iso2 && a.nameEn === b.nameEn);

/** Кусок run целиком в пределах BORDER_HUG_DIST_M от границы страны `flank`? Проверяем до 24 точек вдоль куска. */
function hugsBorder(run: Run, flank: Country, route: Route, geo: GeoIndex): boolean {
  const pts = route.points;
  const count = run.toIdx - run.fromIdx + 1;
  const samples = Math.min(24, count);
  for (let s = 0; s < samples; s++) {
    const i = samples === 1 ? run.fromIdx : run.fromIdx + Math.round((s * (count - 1)) / (samples - 1));
    if (!geo.borderDistM || geo.borderDistM(pts[i].lon, pts[i].lat, flank, BORDER_HUG_DIST_M) === Infinity) return false;
  }
  return true;
}

/**
 * Склеить дрожание у границы: короткий кусок между двумя кусками одной страны, который идёт не дальше 5 км от её
 * границы. «Короткий» — протяжённость (прямая от входа до выхода) < 15 км, а путь вдоль маршрута < 45 км: зигзаг вдоль
 * границы не раздувается шумом, но долгое блуждание рядом с границей остаётся визитом. Дальний заезд — пусть и
 * короткий — тоже остаётся визитом. Первым поглощается кусок, зажатый между самыми крупными соседями.
 */
function mergeFlicker(runs: Run[], route: Route, geo: GeoIndex): Run[] {
  const pts = route.points;
  const pathM = (r: Run) => pts[r.toIdx].d - pts[r.fromIdx].d;
  let list = runs;
  const verdict = new Map<string, boolean>(); // кусок + страна-обрамление → склеивать?
  for (;;) {
    let pick = -1, pickMass = -1, pickLen = Infinity;
    for (let i = 1; i < list.length - 1; i++) {
      const r = list[i];
      const flank = list[i - 1].country;
      if (!flank || !sameCountry(flank, list[i + 1].country)) continue;
      const len = pathM(r);
      if (len >= BORDER_HUG_PATH_MAX_M) continue;
      const chord = haversineM(pts[r.fromIdx].lat, pts[r.fromIdx].lon, pts[r.toIdx].lat, pts[r.toIdx].lon);
      if (chord >= BORDER_HUG_MAX_M) continue;
      const key = `${r.fromIdx}-${r.toIdx}-${flank.iso2}`;
      let hug = verdict.get(key);
      if (hug === undefined) { hug = hugsBorder(r, flank, route, geo); verdict.set(key, hug); }
      if (!hug) continue;
      const mass = Math.max(pathM(list[i - 1]), pathM(list[i + 1]));
      if (mass > pickMass || (mass === pickMass && len < pickLen)) { pick = i; pickMass = mass; pickLen = len; }
    }
    if (pick < 0) return list;
    const merged: Run = { fromIdx: list[pick - 1].fromIdx, toIdx: list[pick + 1].toIdx, country: list[pick - 1].country };
    list = [...list.slice(0, pick - 1), merged, ...list.slice(pick + 2)];
  }
}

/** Высшая точка — сюжет, только если рельеф настоящий: перепад ≥ 300 м и пик ≥ медиана + 200 м. */
function isMeaningfulPeak(route: Route): boolean {
  const max = route.maxEle, min = route.minEle;
  if (!max || !min || max.value - min.value < PEAK_MIN_RANGE_M) return false;
  const eles = Float64Array.from(route.points, (p) => p.ele ?? NaN).filter(Number.isFinite).sort();
  if (!eles.length) return false;
  const m = eles.length >> 1;
  const median = eles.length % 2 ? eles[m] : (eles[m - 1] + eles[m]) / 2;
  return max.value >= median + PEAK_ABOVE_MEDIAN_M;
}

const BEAT_ORDER: Record<Beat['kind'], number> = { start: 0, country: 1, peak: 2, waypoint: 3, finish: 4 };

export function enrichRoute(route: Route, geo: GeoIndex): Enrichment {
  const pts = route.points;
  const n = pts.length;

  // 1. страна каждой точки → куски
  const raw: Run[] = [];
  for (let i = 0; i < n; i++) {
    const c = geo.countryAt(pts[i].lon, pts[i].lat);
    const lastRun = raw[raw.length - 1];
    if (lastRun && sameCountry(lastRun.country, c)) lastRun.toIdx = i;
    else raw.push({ fromIdx: i, toIdx: i, country: c });
  }
  const countryRuns = n ? mergeFlicker(raw, route, geo) : [];

  // 2. уникальные страны по порядку посещения
  const countries: Country[] = [];
  for (const r of countryRuns) {
    if (r.country && !countries.some((c) => sameCountry(c, r.country))) countries.push(r.country);
  }

  // 3. поиск по индексу
  const runStarts = countryRuns.map((r) => r.fromIdx);
  const countryAt = (idx: number): Country | null => {
    if (!(idx >= 0 && idx < n)) return null;
    let lo = 0, hi = runStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (runStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return countryRuns[lo]?.country ?? null;
  };
  const placeCache = new Map<number, Place | null>();
  const placeAt = (idx: number): Place | null => {
    if (!(idx >= 0 && idx < n)) return null;
    const i = Math.round(idx);
    if (placeCache.has(i)) return placeCache.get(i) as Place | null;
    const place = geo.nearestPlace(pts[i].lon, pts[i].lat, PLACE_RADIUS_KM);
    placeCache.set(i, place);
    return place;
  };

  // 4. биты
  const beats: Beat[] = [];
  const mk = (kind: Beat['kind'], idx: number, extra: Partial<Beat> = {}): Beat => {
    const beat: Beat = { kind, idx, place: placeAt(idx), ...extra };
    const country = extra.country ?? countryAt(idx);
    if (country) beat.country = country;
    return beat;
  };

  if (n) {
    beats.push(mk('start', 0));

    let visited: Country | null = null;
    for (const r of countryRuns) {
      if (!r.country) continue;
      if (visited === null) {
        visited = r.country;
        if (r.fromIdx > 0) beats.push(mk('country', r.fromIdx, { country: r.country })); // на сушу вышли не со старта
      } else if (!sameCountry(visited, r.country)) {
        visited = r.country;
        beats.push(mk('country', r.fromIdx, { country: r.country }));
      }
    }

    if (route.hasEle && route.maxEle && isMeaningfulPeak(route)) {
      beats.push(mk('peak', route.maxEle.idx, { ele: route.maxEle.value }));
    }

    for (const w of route.waypoints) {
      const nearStart = pts[w.idx].d - pts[0].d < WAYPOINT_DEDUP_M;
      const nearFinish = pts[n - 1].d - pts[w.idx].d < WAYPOINT_DEDUP_M;
      if (nearStart || nearFinish) continue;
      beats.push(mk('waypoint', w.idx, { label: w.name }));
    }

    beats.push(mk('finish', n - 1));
  }
  beats.sort((a, b) => a.idx - b.idx || BEAT_ORDER[a.kind] - BEAT_ORDER[b.kind]);

  return {
    countryRuns,
    countries,
    beats,
    startPlace: placeAt(0),
    finishPlace: placeAt(n - 1),
    placeAt,
    countryAt,
  };
}

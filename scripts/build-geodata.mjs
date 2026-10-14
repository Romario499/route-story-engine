// Сборка офлайн-географии: Natural Earth (public domain) → компактные public/data/countries.json и places.json.
//
// Запуск (нужен интернет, разово):  npm run build:geodata
// Необязательно:  node scripts/build-geodata.mjs --cache=<папка>  — сырые GeoJSON кладутся/берутся оттуда.
//
// Источники:
//   ne_50m_admin_0_countries  — границы стран 1:50m (поля NAME_RU, NAME_EN, ISO_A2; при ISO_A2 = "-99" берём ISO_A2_EH, затем WB_A2)
//   ne_10m_populated_places   — населённые пункты 1:10m (NAME_RU, NAME_EN, POP_MAX)
//   EXTRA_PLACES (ниже)       — несколько пунктов, которых нет в Natural Earth (пограничные переходы Шёлкового пути);
//                               пункт не добавляется, если в базе уже есть то же английское название в радиусе 15 км
//
// Форматы (их типы — CountriesJson / PlacesJson в src/geo/index.ts):
//   countries.json  { v: 1, scale: 1000, countries: [{ iso2, nameRu, nameEn, bbox: [minLon, minLat, maxLon, maxLat],
//                     polygons: [ [ ring, ring, … ], … ] }] }
//     ring — плоский массив целых чисел в долях 1/scale градуса, дельта-кодирование:
//     [x0, y0, dx1, dy1, dx2, dy2, …]; замыкающая точка не хранится. Первое кольцо полигона — контур, остальные — дырки.
//   places.json     { v: 1, places: [[nameRu, nameEn, lat, lon, pop], …] }, lat/lon с 3 знаками, по убыванию pop.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const COUNTRIES_SRC = 'ne_50m_admin_0_countries.geojson';
const PLACES_SRC = 'ne_10m_populated_places.geojson';

const SCALE = 1000;            // 1/1000° ≈ 110 м
const TOLERANCE_DEG = 0.0015;  // допуск упрощения границ ≈ 170 м
const MIN_RING_SPAN_DEG = 0.02; // кольца меньше этого (крошечные острова) выбрасываем
const MAX_TOTAL_BYTES = 2.5 * 1024 * 1024;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'data');
const cacheArg = process.argv.find((a) => a.startsWith('--cache='));
const cacheDir = cacheArg ? path.resolve(cacheArg.slice('--cache='.length)) : null;

async function loadGeoJson(name) {
  const cached = cacheDir ? path.join(cacheDir, name) : null;
  if (cached && existsSync(cached)) return JSON.parse(await readFile(cached, 'utf8'));
  console.log(`скачиваю ${name} …`);
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  if (cached) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cached, text);
  }
  return JSON.parse(text);
}

// --- упрощение кольца: Дуглас—Пекер (итеративный, без рекурсии) ---

function perpDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/** points — [[lon, lat], …] открытая ломаная; возвращает оставленные точки. */
function douglasPeucker(points, tol) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const d = perpDist2(points[i][0], points[i][1], points[a][0], points[a][1], points[b][0], points[b][1]);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Кольцо GeoJSON (замкнутое) → целочисленное дельта-кодирование или null, если выродилось. */
function encodeRing(ring) {
  let open = ring;
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) open = ring.slice(0, -1);
  if (open.length < 3) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of open) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (maxX - minX < MIN_RING_SPAN_DEG && maxY - minY < MIN_RING_SPAN_DEG) return null;

  // кольцо замкнутое: упрощаем как ломаную от начала до начала, чтобы стык не «срезался»
  const simple = douglasPeucker([...open, open[0]], TOLERANCE_DEG);
  simple.pop();
  // после округления до 1/SCALE убираем подряд идущие дубли
  const q = [];
  for (const [x, y] of simple) {
    const p = [Math.round(x * SCALE), Math.round(y * SCALE)];
    const prev = q[q.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) q.push(p);
  }
  if (q.length > 1 && q[0][0] === q[q.length - 1][0] && q[0][1] === q[q.length - 1][1]) q.pop();
  if (q.length < 3) return null;

  const flat = [q[0][0], q[0][1]];
  for (let i = 1; i < q.length; i++) flat.push(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]);
  return flat;
}

function iso2Of(props) {
  for (const key of ['ISO_A2', 'ISO_A2_EH', 'WB_A2']) {
    const v = props[key];
    if (typeof v === 'string' && /^[A-Z]{2}$/.test(v)) return v;
  }
  // «CN-TW» и подобные: берём вторую часть
  const raw = props.ISO_A2;
  if (typeof raw === 'string' && /^[A-Z]{2}-([A-Z]{2})$/.test(raw)) return raw.slice(3);
  return 'XX'; // спорные территории без кода (Сомалиленд, Сиачен…) — без флага
}

function buildCountries(geo) {
  const countries = [];
  for (const f of geo.features) {
    const p = f.properties;
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    const polygons = [];
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const poly of polys) {
      const outer = encodeRing(poly[0]);
      if (!outer) continue; // контур выродился (мелкий остров) — полигон не нужен
      const rings = [outer];
      for (let i = 1; i < poly.length; i++) {
        const hole = encodeRing(poly[i]);
        if (hole) rings.push(hole);
      }
      polygons.push(rings);
      // bbox по контуру
      let x = outer[0], y = outer[1];
      const upd = () => {
        const lon = x / SCALE, lat = y / SCALE;
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      };
      upd();
      for (let i = 2; i < outer.length; i += 2) { x += outer[i]; y += outer[i + 1]; upd(); }
    }
    if (!polygons.length) continue;
    countries.push({
      iso2: iso2Of(p),
      nameRu: p.NAME_RU || p.NAME_EN || p.NAME,
      nameEn: p.NAME_EN || p.NAME,
      bbox: [minLon, minLat, maxLon, maxLat],
      polygons,
    });
  }
  return { v: 1, scale: SCALE, countries };
}

/**
 * Дополнительные пункты: [nameRu, nameEn, lat, lon, pop]. Natural Earth не знает мелких пограничных городков,
 * из-за чего финиш примера оказывался подписан соседним Жаркентом (35 км). Список короткий и ведётся вручную;
 * pop — условный порядок величины (ближайший пункт выбирается по расстоянию, а не по населению).
 */
const EXTRA_PLACES = [
  ['Хоргос', 'Khorgos', 44.21, 80.41, 20000],
  ['Алашанькоу', 'Alashankou', 45.17, 82.57, 30000],
  ['Торугарт', 'Torugart', 40.525, 75.395, 1000],
];
const EXTRA_DEDUPE_KM = 15;

function distanceKm(lat1, lon1, lat2, lon2) {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function buildPlaces(geo) {
  const rows = [];
  for (const f of geo.features) {
    const p = f.properties;
    const c = f.geometry && f.geometry.coordinates;
    if (!c) continue;
    const nameEn = p.NAME_EN || p.NAME;
    const nameRu = p.NAME_RU || nameEn;
    if (!nameEn) continue;
    const pop = Math.max(0, Math.round(Number(p.POP_MAX) || 0));
    rows.push([nameRu, nameEn, Math.round(c[1] * 1000) / 1000, Math.round(c[0] * 1000) / 1000, pop]);
  }
  for (const extra of EXTRA_PLACES) {
    const known = rows.some((r) => r[1] === extra[1] && distanceKm(r[2], r[3], extra[2], extra[3]) <= EXTRA_DEDUPE_KM);
    if (!known) rows.push(extra);
  }
  rows.sort((a, b) => b[4] - a[4]);
  return { v: 1, places: rows };
}

const countries = buildCountries(await loadGeoJson(COUNTRIES_SRC));
const places = buildPlaces(await loadGeoJson(PLACES_SRC));

await mkdir(outDir, { recursive: true });
const cText = JSON.stringify(countries);
const pText = JSON.stringify(places);
await writeFile(path.join(outDir, 'countries.json'), cText);
await writeFile(path.join(outDir, 'places.json'), pText);

const cBytes = Buffer.byteLength(cText), pBytes = Buffer.byteLength(pText);
console.log(`countries.json: ${countries.countries.length} стран, ${(cBytes / 1024).toFixed(0)} КБ`);
console.log(`places.json: ${places.places.length} пунктов, ${(pBytes / 1024).toFixed(0)} КБ`);
if (cBytes + pBytes > MAX_TOTAL_BYTES) {
  console.error(`Суммарно ${(cBytes + pBytes) / 1048576} МБ — больше лимита 2,5 МБ`);
  process.exit(1);
}

// Сборка встроенного примера: public/samples/wahrier-reconstruction.gpx
//
// ЭТО РЕКОНСТРУКЦИЯ маршрута @wahrier по афише Вайбатона, а не GPS-запись. Линия проложена по реальным дорогам
// OpenStreetMap через города с афиши; высоты — открытый API; время и даты — расчётные (условные).
//
// Запуск (нужен интернет, разово):  npm run build:sample
// Необязательно:  node scripts/build-sample.mjs --cache=<папка>  — ответы OSRM/open-meteo кладутся/берутся оттуда.
//
// Как строится:
//   1. Дороги — OSRM public demo (router.project-osrm.org, профиль driving), по одному запросу на участок между
//      соседними остановками, пауза 1 с. Геометрия участков склеивается, упрощается (Дуглас—Пекер, допуск 60 м)
//      и «досыпается» точками, чтобы шаг не превышал 4 км.
//   2. Паром Решт → Актау — отдельный <trkseg>: прямой отрезок без дорог (в GPX две части трека: до Решта и от Актау).
//   3. Высоты — open-meteo elevation API (до 100 точек за запрос, пауза 0,7 с), затем лёгкое сглаживание.
//   4. Время — расчётное, как у велопутешественника. Скорость зависит от уклона (по высотам на окне ±3 км):
//      ровно ~19 км/ч, подъём 5 % — ~10 км/ч, спуск 5 % — ~30 км/ч (границы 9…32 км/ч, плюс ±7 % «самочувствия»).
//      День начинается около 8:00 местного (пояс = round(долгота/15), как считает «день» приложение; +0…40 мин),
//      длится 70–120 км (детерминированно, в среднем ~95) и не дольше 10,5 ч в седле; ночью трек не пишется
//      (вечерняя и утренняя точки на одном месте). Старт 2025-05-01.
//      Паром Решт → Актау: приложение (T01) считает переездом скачок > 30 км, > 5× медианного шага и со скоростью
//      в 3+ раза выше/ниже медианного темпа файла (~19 км/ч → нужно > 57 или < 6,3 км/ч). Быстрее 57 км/ч паром
//      не ходит, поэтому время парома — честное «от последней точки до первой»: ожидание в порту Ирана плюс переход
//      (~36 ч) = FERRY_HOURS = 144 ч (6 суток, для каспийских паромов это обычное дело) → ~5 км/ч. Скрипт сам
//      проверяет это условие по построенному треку и падает, если оно не выполняется.
//   5. <wpt> — ключевые города (кроме старта и финиша: их подписи даёт «Старт»/«Финиш»).
//
// Участки, где OSRM пришлось разбивать: Ереван → Агарак → Тебриз идёт через пункт Агарак (Армения) — Нордуз (Иран),
// отдельной промежуточной точкой Агарак (38.866, 46.19); Бишкек → Чолпон-Ата идёт через Токмок (42.842, 75.292), иначе OSRM
// выбирает северную дорогу вдоль границы с Казахстаном; остальные участки строятся напрямую между городами.
// Если OSRM вернёт ошибку (NoRoute/TooBig), скрипт остановится и назовёт участок.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'public', 'samples', 'wahrier-reconstruction.gpx');
const cacheArg = process.argv.find((a) => a.startsWith('--cache='));
const cacheDir = cacheArg ? path.resolve(cacheArg.slice('--cache='.length)) : null;

const OSRM = 'https://router.project-osrm.org/route/v1/driving/';
const ELEVATION = 'https://api.open-meteo.com/v1/elevation';

// --- параметры реконструкции ---
const SIMPLIFY_M = 60;          // допуск упрощения геометрии OSRM
const MAX_STEP_M = 4000;        // максимальный шаг между точками трека
const DAY_KM_MIN = 70;          // дистанция дня 70…120 км
const DAY_KM_SPAN = 50;
const RIDE_FROM_H = 8;          // езда с ~8:00 местного
const MAX_RIDE_H = 10.5;        // не дольше этого в седле за день
const FERRY_HOURS = 144;        // Решт → Актау: ожидание в порту + переход, итого (см. шапку)
const GRADE_WINDOW_M = 3000;    // окно оценки уклона
const START_DATE = Date.UTC(2025, 4, 1); // 1 мая 2025, дата условная

// Остановки по порядку. wpt: true — попадает в <wpt>. part: 'A' до парома, 'B' после.
const STOPS_A = [
  { name: 'Трабзон', lat: 41.0027, lon: 39.7168 },
  { name: 'Батуми', lat: 41.6168, lon: 41.6367, wpt: true },
  { name: 'Тбилиси', lat: 41.7151, lon: 44.8271, wpt: true },
  { name: 'Ереван', lat: 40.1792, lon: 44.5086, wpt: true },
  { name: 'Агарак — граница Армения / Иран', lat: 38.866, lon: 46.19 },
  { name: 'Тебриз', lat: 38.08, lon: 46.2919, wpt: true },
  { name: 'Решт — берег Каспия, паром', lat: 37.2808, lon: 49.5832, wpt: true },
];
const STOPS_B = [
  { name: 'Актау', lat: 43.6532, lon: 51.1572, wpt: true },
  { name: 'Нукус', lat: 42.46, lon: 59.61, wpt: true },
  { name: 'Хива', lat: 41.3775, lon: 60.3619, wpt: true },
  { name: 'Бухара', lat: 39.7681, lon: 64.4556, wpt: true },
  { name: 'Самарканд', lat: 39.6542, lon: 66.9597, wpt: true },
  { name: 'Ташкент', lat: 41.2995, lon: 69.2401, wpt: true },
  { name: 'Шымкент', lat: 42.3417, lon: 69.5901, wpt: true },
  { name: 'Тараз', lat: 42.9, lon: 71.3667, wpt: true },
  { name: 'Бишкек', lat: 42.8746, lon: 74.5698, wpt: true },
  { name: 'Токмок — через южную часть Чуйской долины', lat: 42.8419, lon: 75.2917 },
  { name: 'Чолпон-Ата', lat: 42.6497, lon: 77.0826, wpt: true },
  { name: 'Каракол', lat: 42.4907, lon: 78.3936, wpt: true },
  { name: 'Кеген', lat: 42.9, lon: 79.2, wpt: true },
  { name: 'Алматы', lat: 43.2389, lon: 76.8897, wpt: true },
  { name: 'Жаркент', lat: 44.1667, lon: 79.9833, wpt: true },
  { name: 'Хоргос', lat: 44.2022, lon: 80.4183 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cachedJson(url) {
  const file = cacheDir ? path.join(cacheDir, createHash('sha1').update(url).digest('hex') + '.json') : null;
  if (file && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  let lastErr;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'route-story-engine/0.1 (sample builder)' } });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (file) {
        await mkdir(cacheDir, { recursive: true });
        await writeFile(file, JSON.stringify(data));
      }
      return data;
    } catch (e) {
      lastErr = e;
      await sleep(3000 * attempt);
    }
  }
  throw new Error(`${url.slice(0, 120)}… — ${lastErr?.message}${lastErr?.cause ? ` (${lastErr.cause.code ?? lastErr.cause.message})` : ""}`);
}

// --- геометрия ---
const R = 6371008.8, RAD = Math.PI / 180;
function haversine(a, b) {
  const dLat = (b[1] - a[1]) * RAD, dLon = (b[0] - a[0]) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * RAD) * Math.cos(b[1] * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Дуглас—Пекер в локальных метрах (экви-прямоугольная проекция вокруг средней широты). */
function simplify(points, tolM) {
  const n = points.length;
  if (n <= 2) return points.slice();
  const k = Math.cos((points[(n / 2) | 0][1] * Math.PI) / 180);
  const xs = points.map((p) => p[0] * RAD * R * k), ys = points.map((p) => p[1] * RAD * R);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const dx = xs[b] - xs[a], dy = ys[b] - ys[a];
    const len2 = dx * dx + dy * dy;
    let best = -1, bestD = tolM;
    for (let i = a + 1; i < b; i++) {
      let t = len2 ? ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(xs[a] + t * dx - xs[i], ys[a] + t * dy - ys[i]);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Не даём шагу быть длиннее maxM: вставляем точки по прямой между соседними. */
function densify(points, maxM) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const parts = Math.ceil(haversine(a, b) / maxM);
    for (let j = 1; j < parts; j++) out.push([a[0] + ((b[0] - a[0]) * j) / parts, a[1] + ((b[1] - a[1]) * j) / parts]);
    out.push(b);
  }
  return out;
}

// --- дороги ---
/** Участок по дорогам между остановками → точки [lon, lat] и индексы остановок в них. */
async function roadPart(stops, label) {
  const points = [];
  const stopIdx = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    const url = `${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=full&geometries=geojson&continue_straight=false`;
    const data = await cachedJson(url);
    if (data.code !== 'Ok' || !data.routes?.length) {
      throw new Error(`OSRM: участок ${a.name} → ${b.name} не построен (${data.code}: ${data.message ?? ''}). Разбейте его промежуточной точкой.`);
    }
    const route = data.routes[0];
    const coords = route.geometry.coordinates.map((c) => [c[0], c[1]]);
    const straight = haversine([a.lon, a.lat], [b.lon, b.lat]);
    console.log(`[${label}] ${a.name} → ${b.name}: ${(route.distance / 1000).toFixed(0)} км по дорогам (по прямой ${(straight / 1000).toFixed(0)}), ${coords.length} вершин`);
    if (route.distance > straight * 2.6 + 30_000) {
      throw new Error(`Подозрительный объезд на участке ${a.name} → ${b.name}: ${(route.distance / 1000).toFixed(0)} км при ${(straight / 1000).toFixed(0)} км по прямой`);
    }
    const piece = densify(simplify(coords, SIMPLIFY_M), MAX_STEP_M);
    if (i === 0) stopIdx.push(0);
    for (let j = i === 0 ? 0 : 1; j < piece.length; j++) points.push(piece[j]);
    stopIdx.push(points.length - 1);
    await sleep(cacheDir ? 0 : 1000);
  }
  return { points, stopIdx };
}

// --- высоты ---
async function elevations(points) {
  const out = new Array(points.length);
  for (let i = 0; i < points.length; i += 100) {
    const chunk = points.slice(i, i + 100);
    const lat = chunk.map((p) => p[1].toFixed(4)).join(',');
    const lon = chunk.map((p) => p[0].toFixed(4)).join(',');
    const data = await cachedJson(`${ELEVATION}?latitude=${lat}&longitude=${lon}`);
    if (!Array.isArray(data.elevation) || data.elevation.length !== chunk.length) {
      throw new Error(`open-meteo: неожиданный ответ на пачку ${i}: ${JSON.stringify(data).slice(0, 200)}`);
    }
    data.elevation.forEach((e, j) => { out[i + j] = e; });
    if ((i / 100) % 10 === 0) console.log(`высоты: ${Math.min(i + 100, points.length)} / ${points.length}`);
    await sleep(cacheDir ? 0 : 700);
  }
  // сглаживание окном в 5 точек (DEM 90 м шумит на склонах)
  return out.map((_, i) => {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(out.length - 1, i + 2); j++) { s += out[j]; c++; }
    return Math.round(s / c);
  });
}

// --- время ---
const H = 3_600_000;
const solarOffsetH = (lon) => Math.round(lon / 15);
const localDayOf = (utcMs, lon) => Math.floor((utcMs + solarOffsetH(lon) * H - START_DATE) / (24 * H)); // 0 = 1 мая

/** Детерминированная «случайность» 0…1 по номеру. */
const rnd = (k) => {
  const x = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Скорость велосипедиста (км/ч) по уклону в процентах. */
function speedKmh(gradePct, k) {
  const v = 19 * Math.exp(-0.12 * gradePct) * (0.93 + 0.14 * rnd(k));
  return Math.max(9, Math.min(32, v));
}

/**
 * Время точек участка [lon, lat, ele]. firstDay — номер локального дня выезда (0 = START_DATE), seed — для вариаций.
 * Скорость — от уклона, день — 70–120 км, старт около 8:00; ночью трек не пишется: вечерняя и утренняя точка на одном месте.
 */
function timeline(points, firstDay, seed) {
  const n = points.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));

  // уклон в каждой точке по окну ±GRADE_WINDOW_M
  const grade = new Float64Array(n);
  let lo = 0, hi = 0;
  for (let i = 0; i < n; i++) {
    while (lo < i && cum[i] - cum[lo] > GRADE_WINDOW_M) lo++;
    if (hi < i) hi = i;
    while (hi < n - 1 && cum[hi] - cum[i] < GRADE_WINDOW_M) hi++;
    const run = cum[hi] - cum[lo];
    grade[i] = run > 0 ? ((points[hi][2] - points[lo][2]) / run) * 100 : 0;
  }

  const dayLimitM = (d) => (DAY_KM_MIN + DAY_KM_SPAN * rnd(seed + d * 7 + 1)) * 1000;
  const dayStart = (d, lon) =>
    START_DATE + (firstDay + d) * 24 * H + (RIDE_FROM_H + (rnd(seed + d * 3 + 2) * 40) / 60) * H - solarOffsetH(lon) * H;

  const out = [];
  let day = 0, dayDist = 0, rideMs = 0, limit = dayLimitM(0);
  let t = dayStart(0, points[0][0]);
  out.push({ lon: points[0][0], lat: points[0][1], ele: points[0][2], t });
  for (let i = 1; i < n; i++) {
    const a = points[i - 1], b = points[i];
    const L = cum[i] - cum[i - 1];
    if (L <= 0) continue;
    const v = speedKmh((grade[i - 1] + grade[i]) / 2, seed + i); // км/ч
    const mps = v / 3.6;
    let f0 = 0;
    for (;;) {
      const segLeft = L * (1 - f0);
      const room = Math.min(limit - dayDist, (MAX_RIDE_H * H - rideMs) / 1000 * mps);
      if (segLeft <= room + 1e-6) {
        const dt = (segLeft / mps) * 1000;
        t += dt; rideMs += dt; dayDist += segLeft;
        out.push({ lon: b[0], lat: b[1], ele: b[2], t });
        break;
      }
      f0 += room / L;
      const dt = (room / mps) * 1000;
      t += dt;
      const q = { lon: a[0] + (b[0] - a[0]) * f0, lat: a[1] + (b[1] - a[1]) * f0, ele: Math.round(a[2] + (b[2] - a[2]) * f0) };
      out.push({ ...q, t });
      day++; dayDist = 0; rideMs = 0; limit = dayLimitM(day);
      t = dayStart(day, q.lon);
      out.push({ ...q, t });
    }
  }
  return { points: out, totalM: cum[n - 1], days: day + 1 };
}

const fmtTime = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const trkpt = (p) =>
  `      <trkpt lat="${p.lat.toFixed(5)}" lon="${p.lon.toFixed(5)}"><ele>${p.ele}</ele><time>${fmtTime(p.t)}</time></trkpt>`;

const TITLE = 'Реконструкция маршрута @wahrier по афише (не GPS-запись)';
const DESC =
  'Реконструкция маршрута по афише, не GPS-запись: линия проложена по дорогам OpenStreetMap (OSRM) через города с афиши, ' +
  'высоты — open-meteo, даты и время расчётные (~90 км в день, езда 8:00–18:00 местного), паром Решт — Актау — прямой отрезок.';

async function main() {
  const partA = await roadPart(STOPS_A, 'A');
  const partB = await roadPart(STOPS_B, 'B');
  const nA = partA.points.length;
  console.log(`точек: A ${nA}, B ${partB.points.length}, всего ${nA + partB.points.length}`);

  const ele = await elevations([...partA.points, ...partB.points]);
  const withEle = (pts, off) => pts.map((p, i) => [p[0], p[1], ele[off + i]]);
  const ptsA = withEle(partA.points, 0);
  const ptsB = withEle(partB.points, nA);

  const tlA = timeline(ptsA, 0, 0);
  const lastA = tlA.points[tlA.points.length - 1];
  const arrivalMs = lastA.t + FERRY_HOURS * H;
  const portLon = ptsB[0][0];
  const arrivalDay = localDayOf(arrivalMs, portLon);
  const localHour = ((((arrivalMs + solarOffsetH(portLon) * H) % (24 * H)) + 24 * H) % (24 * H)) / H;
  const firstDayB = localHour < RIDE_FROM_H ? arrivalDay : arrivalDay + 1;
  const tlB = timeline(ptsB, firstDayB, 1000);
  // в порту после парома — точка прибытия, затем стоянка до утра (первая точка таймлайна B — утренняя)
  const arrival = { ...tlB.points[0], t: arrivalMs };
  const segB = [arrival, ...tlB.points];

  const ferryKm = haversine([lastA.lon, lastA.lat], [arrival.lon, arrival.lat]) / 1000;
  const ferryKmh = ferryKm / FERRY_HOURS;
  // медианный темп файла так же, как считает приложение: по шагам с ненулевой длиной и ростом времени
  const speeds = [];
  for (const seg of [tlA.points, tlB.points]) {
    for (let i = 1; i < seg.length; i++) {
      const d = haversine([seg[i - 1].lon, seg[i - 1].lat], [seg[i].lon, seg[i].lat]);
      const dt = seg[i].t - seg[i - 1].t;
      if (d > 0 && dt > 0) speeds.push((d / 1000) / (dt / H));
    }
  }
  speeds.sort((x, y) => x - y);
  const medKmh = speeds[speeds.length >> 1];
  console.log(`дней: A ${tlA.days}, B ${tlB.days}; дорог ${((tlA.totalM + tlB.totalM) / 1000).toFixed(0)} км; медианный темп ${medKmh.toFixed(1)} км/ч, максимум шага ${speeds[speeds.length - 1].toFixed(1)}`);
  console.log(`паром ${ferryKm.toFixed(0)} км за ${FERRY_HOURS} ч (${ferryKmh.toFixed(1)} км/ч)`);
  if (!(ferryKmh > 3.2 * medKmh || ferryKmh < medKmh / 3.2)) {
    throw new Error('Паром не распознается приложением как переезд (скорость не в 3+ раза выше/ниже темпа файла). Измените FERRY_HOURS.');
  }

  // <wpt>: города, привязанные к точкам трека
  const wpts = [];
  const addWpts = (stops, stopIdx, pts) => {
    stops.forEach((st, k) => {
      if (!st.wpt) return;
      const p = pts[stopIdx[k]];
      wpts.push(`  <wpt lat="${p[1].toFixed(5)}" lon="${p[0].toFixed(5)}"><ele>${p[2]}</ele><name>${esc(st.name)}</name><desc>Город с афиши (реконструкция)</desc></wpt>`);
    });
  };
  addWpts(STOPS_A, partA.stopIdx, ptsA);
  addWpts(STOPS_B, partB.stopIdx, ptsB);

  const gpx = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Route Story Engine · scripts/build-sample.mjs" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${esc(TITLE)}</name>`,
    `    <desc>${esc(DESC)}</desc>`,
    '  </metadata>',
    ...wpts,
    '  <trk>',
    `    <name>${esc(TITLE)}</name>`,
    `    <desc>${esc(DESC)}</desc>`,
    '    <trkseg>',
    ...tlA.points.map(trkpt),
    '    </trkseg>',
    '    <trkseg>',
    ...segB.map(trkpt),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
    '',
  ].join('\n');

  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, gpx);
  const total = tlA.points.length + segB.length;
  console.log(`записано ${path.relative(root, outFile)}: ${total} точек, ${(Buffer.byteLength(gpx) / 1024).toFixed(0)} КБ`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

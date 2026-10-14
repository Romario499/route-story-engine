#!/usr/bin/env node
// Node >= 22.18: встроенный strip types + локальные extensionless TS-импорты. Никаких сетевых обращений.
import { registerHooks } from 'node:module';
import { readFile, mkdir, realpath, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const routeRoot = new URL('../src/', import.meta.url).href;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(routeRoot) && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const { parseRouteFiles, summarizeKmlImport } = await import('../src/route/index.ts');
const { haversineM } = await import('../src/route/geo-math.ts');
const { createGeoIndex } = await import('../src/geo/index.ts');

const DAY = 86400000;
const round = (v) => Math.round(v * 10) / 10; // сетка 0,1°
function date(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('Дата должна иметь вид YYYY-MM-DD');
  const n = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value) throw new Error('Некорректная дата');
  return n;
}
function fileDateOf(input) {
  const m = /_(\d{2})(\d{2})(\d{2})\.kmz$/i.exec(input);
  return m ? `20${m[1]}-${m[2]}-${m[3]}` : undefined;
}
const counts = (points, key) => points.reduce((out, p) => { const k = key(p); out[k] = (out[k] ?? 0) + 1; return out; }, {});
function greenSteps(points) {
  const green = points.filter((p) => p.color === 'green'), steps = [];
  for (let i = 1; i < green.length; i++) steps.push(haversineM(green[i - 1].lat, green[i - 1].lon, green[i].lat, green[i].lon) / 1000);
  steps.sort((a, b) => a - b);
  const n = steps.length, mid = n >> 1;
  return { points: green.length, medianKm: n ? Math.round(n % 2 ? steps[mid] : (steps[mid - 1] + steps[mid]) / 2) : 0,
    p90Km: n ? Math.round(steps[Math.ceil(n * .9) - 1]) : 0, maxKm: n ? Math.round(steps[n - 1]) : 0 };
}

// Закладки ставят в любом месте мира, а markedAt — момент создания: отбор «участка» только по датам цепляет чужие места
// (Гонконг, Ереван, Вьетнам в узбекских сутках). Поэтому участок ограничен ещё и географически:
//   --bbox minLon minLat maxLon maxLat | --country ISO2; по умолчанию страна — та, где больше всего меток участка.
async function geoFilter(chosen, { bbox, country }) {
  if (bbox) {
    const [w, s, e, n] = bbox;
    return { label: { bbox }, inside: (p) => p.lon >= w && p.lon <= e && p.lat >= s && p.lat <= n };
  }
  const read = async (name) => JSON.parse(await readFile(new URL(`../public/data/${name}`, import.meta.url), 'utf8'));
  const geo = createGeoIndex(await read('countries.json'), await read('places.json'));
  let code = country?.toUpperCase();
  if (!code) {
    const votes = counts(chosen.map((p) => geo.countryAt(p.lon, p.lat)?.iso2).filter(Boolean), (iso) => iso);
    code = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (!code) throw new Error('Не удалось определить страну участка: задайте --country ISO2 или --bbox minLon minLat maxLon maxLat');
  }
  return { label: { country: code }, inside: (p) => geo.countryAt(p.lon, p.lat)?.iso2 === code };
}

// После огрубления до сетки 0,1° остаются точные дубли: тот же пункт, тот же вид метки, те же UTC-сутки закладки.
function coarsen(points) {
  const out = new Map();
  for (const p of points) {
    const lat = round(p.lat), lon = round(p.lon);
    const key = [lat, lon, p.color, p.kind, Math.floor(p.markedAt / DAY)].join('|');
    const first = out.get(key);
    if (first) first.duplicates += p.duplicates + 1;
    else out.set(key, { lat, lon, color: p.color, kind: p.kind, confidence: p.confidence, markedAt: p.markedAt,
      // Имена Point могут раскрыть адрес; пути источника тоже не входят в огрублённую выборку.
      source: (() => { const c = p.source.collection.split(/[\\/]/).filter(Boolean).at(-1) ?? 'collection'; return { file: c, collection: c }; })(),
      duplicates: p.duplicates });
  }
  return [...out.values()];
}

try {
  const args = process.argv.slice(2), input = args.shift();
  if (!input || input.startsWith('--')) throw new Error('Укажите входной KML/KMZ; --report или --segment YYYY-MM-DD YYYY-MM-DD [--out файл]');
  let reportOnly = false, segment, out, fileDate = fileDateOf(input), bbox, country;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--report') reportOnly = true;
    else if (flag === '--segment' && args.length >= 2) segment = [args.shift(), args.shift()];
    else if (flag === '--bbox' && args.length >= 4) {
      bbox = [args.shift(), args.shift(), args.shift(), args.shift()].map(Number);
      if (bbox.some((v) => !Number.isFinite(v)) || bbox[0] > bbox[2] || bbox[1] > bbox[3]) throw new Error('--bbox: minLon minLat maxLon maxLat, числа, минимум не больше максимума');
    } else if (flag === '--country' && args.length) {
      country = args.shift();
      if (!/^[A-Za-z]{2}$/.test(country)) throw new Error('--country: двухбуквенный код страны (ISO2)');
    }
    else if (flag === '--out' && args.length) out = args.shift();
    else if (flag === '--file-date' && args.length) fileDate = args.shift();
    else throw new Error('Неизвестный или неполный аргумент');
  }
  if ((!reportOnly && !segment) || ((out || bbox || country) && !segment)) throw new Error('Выборка требует --segment; для сводки используйте --report');
  if (bbox && country) throw new Error('Участок ограничивается либо --bbox, либо --country');
  const source = await realpath(resolve(input)), bytes = await readFile(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const parsed = await parseRouteFiles([new File([bytes], input)], {
    inflateRaw: async (data) => new Uint8Array(inflateRawSync(data, { maxOutputLength: 32 * 1024 * 1024 })),
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const { all, selected, report } = summarizeKmlImport(parsed.tracks);
  const timed = all.filter((p) => p.markedAt !== undefined && p.markedAt >= (selected[0]?.markedAt ?? Infinity));
  let batchedUnder2Min = 0;
  for (let i = 1; i < timed.length; i++) if (timed[i].markedAt - timed[i - 1].markedAt < 120000) batchedUnder2Min++;
  const summary = { ...report, archiveKmlFiles: parsed.tracks.filter((t) => t.kmlImport).length, sha256,
    colors: counts(all, (p) => p.color), journeyColors: counts(selected, (p) => p.color),
    colorsByYear: counts(all, (p) => `${p.markedAt === undefined ? 'undated' : new Date(p.markedAt).getUTCFullYear()}:${p.color}`),
    markedAtIs: 'bookmark-created-at', adjacentTimedPairs: Math.max(0, timed.length - 1), batchedUnder2Min,
    greenChain: greenSteps(selected.filter((p) => p.markedAt >= Date.UTC(2025, 4, 1))) };
  if (reportOnly) console.log(JSON.stringify(summary, null, 2));
  if (segment) {
    const from = date(segment[0]), to = date(segment[1]) + DAY - 1;
    if (from > to) throw new Error('Начало участка позже конца');
    if (!fileDate) throw new Error('Дата файла неизвестна: задайте --file-date YYYY-MM-DD');
    const cutoff = date(fileDate) - 90 * DAY;
    // Период участка явный: эвристика начала полной поездки в Турции здесь не применяется.
    const byDate = summarizeKmlImport(parsed.tracks, { from, to }).selected;
    const geo = await geoFilter(byDate, { bbox, country });
    const chosen = byDate.filter(geo.inside); // по точным координатам, до огрубления
    const excludedOutside = byDate.length - chosen.length;
    const old = chosen.filter((p) => Math.floor(p.markedAt / DAY) * DAY <= cutoff);
    if (!old.length) throw new Error('В выбранном участке нет меток старше последних 90 дней');
    const target = resolve(out ?? `private/waypoints-${segment[0]}-${segment[1]}.json`);
    if (target === source) throw new Error('Исходник нельзя перезаписывать');
    const waypoints = coarsen(old), collapsedDuplicates = old.length - waypoints.length;
    // wx запрещает перезапись, в том числе ссылок/алиасов исходника, и сохраняет прежние выборки.
    const sample = { source: { kind: 'waypoints' }, segment: { from: segment[0], to: segment[1], ...geo.label, excludedOutside }, sourceSha256: sha256,
      privacy: { gridDegrees: 0.1, fileDate, excludedRecent: chosen.length - old.length },
      waypoints };
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(sample, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ selected: waypoints.length, excludedRecent: chosen.length - old.length, excludedOutside, collapsedDuplicates, ...geo.label, gridDegrees: 0.1 }));
  }
  if (createHash('sha256').update(await readFile(source)).digest('hex') !== sha256) throw new Error('Исходный файл изменился во время чтения');
} catch (error) {
  // Текст исключений ОС может содержать личный путь: наружу только наши сообщения, без стека/координат.
  console.error(error?.code ? 'Не удалось прочитать исходник или создать новый файл выборки' : error.message);
  process.exitCode = 1;
}

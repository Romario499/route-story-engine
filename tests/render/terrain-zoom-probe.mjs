// Проба рельефа на сильном зуме (ADR 0009, п. 6): покадрово проходит ролик настоящей сценой и сообщает, на каком кадре MapLibre
// падает («Cannot read properties of undefined (reading 'clearFadeHold')»). Нужны dev-сервер на 5182, Edge и интернет.
//   npm run dev -- --port 5182 --strictPort
//   node tests/render/terrain-zoom-probe.mjs <файл.gpx> [стиль=epic] [формат=9:16] [pixelRatio=1] [шаг,с=0.5] [вариант=none|noterrain|nohills|noimagery] [от=0] [до=30]
import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const gpx = readFileSync(process.argv[2], 'utf8');
const T0 = Number(process.argv[8] ?? 0), T1 = Number(process.argv[9] ?? 30);
const [styleId, format, ratio, step, variant] = [process.argv[3] ?? 'epic', process.argv[4] ?? '9:16', Number(process.argv[5] ?? 1), Number(process.argv[6] ?? 0.5), process.argv[7] ?? 'none'];
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
await page.goto('http://localhost:5182/');
await page.waitForTimeout(1500);
const out = await page.evaluate(async ({ gpx, styleId, format, ratio, step, variant, T0, T1 }) => {
  const [{ createScene }, { parseRouteText, buildRoute }, { enrichRoute }, { loadGeoData }, { buildTimeline }, { timelineOptionsFor }] = await Promise.all([
    import('/src/render/scene.ts'), import('/src/route/index.ts'), import('/src/geo/index.ts'),
    import('/src/geo/load.ts'), import('/src/story/index.ts'), import('/src/render/layout.ts'),
  ]);
  const { STYLES } = await import('/src/render/styles.ts');
  const ms = STYLES[styleId].mapStyle;
  if (variant === 'noterrain') delete ms.terrain;
  if (variant === 'nohills') ms.layers = ms.layers.filter((l) => l.id !== 'hills');
  if (variant === 'noimagery') ms.layers = ms.layers.filter((l) => l.id !== 'imagery');
  const ml = await import(performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('maplibre-gl.js')));
  const MapCls = (ml.Map ?? ml.default?.Map);
  const origJump = MapCls.prototype.jumpTo;
  MapCls.prototype.jumpTo = function (...a) { window.__map = this; return origJump.apply(this, a); };
  const route = buildRoute(parseRouteText('triglav.gpx', gpx).tracks);
  const enrichment = enrichRoute(route, await loadGeoData('/'));
  const settings = { styleId, format, durationSec: 30, lang: 'ru', title: '', author: '', showSafeZones: false,
    info: { distance: true, day: false, date: false, country: true, city: false, altitude: false, speed: false, profile: false, progress: true } };
  const timeline = buildTimeline(route, enrichment, settings, timelineOptionsFor(format, styleId));
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;background:#000'; document.body.append(host);
  const scene = await createScene(host, { format, styleId, pixelRatio: ratio });
  scene.setData(route, enrichment, settings, false);
  const log = []; const t0 = performance.now();
  for (let t = T0; t <= T1; t += step) {
    const f = timeline.frameAt(t);
    try { await scene.render(f, { waitForTiles: true, timeoutMs: 20000 }); log.push(`t=${t} z=${f.camera.zoom.toFixed(2)} p=${f.camera.pitch.toFixed(2)} ok`); }
    catch (e) {
      log.push(`t=${t} z=${f.camera.zoom.toFixed(2)} p=${f.camera.pitch.toFixed(2)} FAIL ${e.message}`);
      const m = window.__map;
      const tr = m.transform;
      log.push(`transform zoom=${tr.zoom} tileZoom=${tr.tileZoom} elevation=${tr.elevation} pitch=${tr.pitch}`);
      for (const [id, sc] of Object.entries(m.style.sourceCaches)) log.push(`sc ${id} tiles=${Object.keys(sc._tiles).length} maxz=${sc._source.maxzoom} tileSize=${sc._source.tileSize} covZ=${tr.coveringZoomLevel(sc._source)} terrainUse=${sc.usedForTerrain}`);
      const tsc = m.terrain?.sourceCache; if (tsc) log.push(`terrain sc tiles=${Object.keys(tsc._tiles).length} covZ=${tr.coveringZoomLevel({ tileSize: tsc.tileSize, roundZoom: false })}`);
      log.push(e.stack.split(String.fromCharCode(10)).slice(0,4).join(' | '));
      break;
    }
  }
  log.push(`ms total ${Math.round(performance.now() - t0)}`);
  return log;
}, { gpx, styleId, format, ratio, step, variant, T0, T1 });
console.log(out.join('\n'));
await browser.close();

import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { restrictNetwork } from '../e2e/materials.mjs';
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext(); await restrictNetwork(context);
  const page = await context.newPage(); await page.goto('http://localhost:5182/');
  const profile = await context.newCDPSession(page);
  await profile.send('Profiler.enable'); await profile.send('Profiler.start');
  const facts = await page.evaluate(async gpx => {
    const [{ createScene }, { parseRouteText, buildRoute }, { enrichRoute }, { loadGeoData }, { buildTimeline }, { timelineOptionsFor }] = await Promise.all([
      import('/src/render/scene.ts'), import('/src/route/index.ts'), import('/src/geo/index.ts'),
      import('/src/geo/load.ts'), import('/src/story/index.ts'), import('/src/render/layout.ts'),
    ]);
    const ml = await import(performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('maplibre-gl.js')));
    const Map = ml.Map ?? ml.default.Map;
    const draw = Map.prototype.redraw, jump = Map.prototype.jumpTo;
    let map, drawMs = 0, draws = 0;
    Map.prototype.jumpTo = function(...a) { map = this; return jump.apply(this, a); };
    Map.prototype.redraw = function(...a) { const t = performance.now(); const r = draw.apply(this, a); drawMs += performance.now() - t; draws++; return r; };
    const route = buildRoute(parseRouteText('track.gpx', gpx).tracks);
    const enrichment = enrichRoute(route, await loadGeoData('/'));
    const settings = { styleId: 'epic', format: '16:9', durationSec: 30, lang: 'ru', title: '', author: '', showSafeZones: false,
      info: { distance: true, day: false, date: false, country: true, city: false, altitude: true, speed: false, profile: true, progress: true } };
    const tl = buildTimeline(route, enrichment, settings, timelineOptionsFor(settings.format, settings.styleId));
    const host = document.createElement('div'); document.body.append(host);
    const scene = await createScene(host, { format: settings.format, styleId: settings.styleId, pixelRatio: 2 });
    scene.setData(route, enrichment, settings, false);
    const log = [];
    for (const t of [0, 2, 6, 10, 17, 20, 28, 29.9667]) {
      const f = tl.frameAt(t), start = performance.now(); drawMs = 0; draws = 0;
      const result = await scene.render(f, { waitForTiles: true, timeoutMs: 10000 });
      const runtime = performance.now() - start;
      const count = Object.fromEntries(Object.entries(map.style.sourceCaches).map(([id, sc]) => [id, Object.keys(sc._tiles).length]));
      const missing = Object.fromEntries(Object.entries(map.style.sourceCaches).filter(([,sc]) => sc.used || sc.usedForTerrain).map(([name, sc]) => {
        const s = sc._source;
        const ids = map.transform.coveringTiles({ tileSize: sc.usedForTerrain ? sc.tileSize : s.tileSize,
          minzoom: s.minzoom, maxzoom: s.maxzoom, roundZoom: sc.usedForTerrain ? false : s.roundZoom,
          reparseOverscaled: s.reparseOverscaled, terrain: map.terrain });
        return [name, ids.filter(id => !sc._tiles[id.key]?.hasData()).map(id => ({ key: id.key, z: id.overscaledZ,
          parents: [1,2,3].map(d => { const p = id.scaledTo(Math.max(0,id.overscaledZ-d)); return { key:p.key, loaded:sc._tiles[p.key]?.hasData(), renderable:sc.getRenderableIds().includes(p.key) }; }) }))];
      }));
      log.push({ t, runtime, drawMs, draws, result, count, pitch: map.getPitch(), zoom: map.getZoom(),
        E: map.terrain?.exaggeration, head: map.project(f.headLonLat), missing,
        image: scene.canvas.toDataURL('image/png') });
    }
    scene.destroy(); return log;
  }, readFileSync(resolve('tracks/triglav.gpx'), 'utf8'));
  const { profile: cpu } = await profile.send('Profiler.stop');
  const dir = resolve('private/t28/probe'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'cpu.json'), JSON.stringify(cpu));
  for (const f of facts) {
    writeFileSync(resolve(dir, `${f.t}.png`), Buffer.from(f.image.split(',')[1], 'base64')); delete f.image;
    console.log(JSON.stringify(f));
  }
  writeFileSync(resolve(dir, 'facts.json'), JSON.stringify(facts, null, 2));
} finally { await browser.close(); }

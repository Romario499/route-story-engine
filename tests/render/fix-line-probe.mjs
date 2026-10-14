// Diagnostic only: real timeline, rendered MapLibre matrices, no private inputs.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { restrictNetwork } from '../e2e/materials.mjs';
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const context = await browser.newContext(); await restrictNetwork(context);
  const page = await context.newPage(); await page.goto('http://localhost:5196/');
  const facts = await page.evaluate(async gpx => {
    const [{ createScene }, { parseRouteText, buildRoute }, { enrichRoute }, { loadGeoData }, { buildTimeline }, { timelineOptionsFor }, track] = await Promise.all([
      import('/src/render/scene.ts'), import('/src/route/index.ts'), import('/src/geo/index.ts'),
      import('/src/geo/load.ts'), import('/src/story/index.ts'), import('/src/render/layout.ts'), import('/src/render/track.ts'),
    ]);
    const ml = await import(performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('maplibre-gl.js')));
    const Map = ml.Map ?? ml.default.Map, jump = Map.prototype.jumpTo;
    let map;
    Map.prototype.jumpTo = function(...a) { map = this; return jump.apply(this, a); };
    const route = buildRoute(parseRouteText('sample.gpx', gpx).tracks);
    const enrichment = enrichRoute(route, await loadGeoData('/'));
    const logs = [];
    for (const [durationSec, time] of [[30, 17], [60, 28]]) {
      const settings = { styleId: 'epic', format: '16:9', durationSec, lang: 'ru', title: '', author: '', showSafeZones: false,
        info: { distance: true, day: false, date: false, country: true, city: false, altitude: true, speed: false, profile: true, progress: true } };
      const tl = buildTimeline(route, enrichment, settings, timelineOptionsFor(settings.format, settings.styleId));
      const host = document.createElement('div'); document.body.append(host);
      const scene = await createScene(host, { format: settings.format, styleId: settings.styleId, pixelRatio: 2 });
      scene.setData(route, enrichment, settings, false);
      const frame = tl.frameAt(time);
      const result = await scene.render(frame, { waitForTiles: true, timeoutMs: 20000 });
      const m = track.prepareTrack(route), tr = map.transform;
      const depth = (lon, lat) => {
        const ll = new (ml.LngLat ?? ml.default.LngLat)(lon, lat), c = tr.locationCoordinate(ll);
        const elevation = map.terrain ? map.terrain.getElevationForLngLatZoom(ll, tr.tileZoom) : 0;
        const matrix = map.terrain ? tr.pixelMatrix3D : tr.pixelMatrix;
        const v = [c.x * tr.worldSize, c.y * tr.worldSize, elevation, 1];
        const p = Array.from({length: 4}, (_, row) => v.reduce((s, n, col) => s + matrix[col * 4 + row] * n, 0));
        return { x:p[0]/p[3], y:p[1]/p[3], z:p[2], w:p[3], valid:p[3]>1e-7 && p[2]>=-p[3] };
      };
      const half = Math.hypot(960,540)/2, radius = half * 3.2 / tr.worldSize;
      const c = tr.locationCoordinate(tr.center);
      const keep = track.visibleDisplay(m,c.x,c.y,radius), k = track.displayIndexAtHead(m,frame.head);
      const edges = [];
      const add = (a,b,transfer) => {
        if (frame.shot && transfer) return;
        if (a !== 'HEAD' && b !== 'HEAD' && !keep[a] && !keep[b]) return;
        const p = a === 'HEAD' ? depth(...frame.headLonLat) : depth(m.lon[a],m.lat[a]);
        const q = b === 'HEAD' ? depth(...frame.headLonLat) : depth(m.lon[b],m.lat[b]);
        if (p.valid !== q.valid || p.w * q.w <= 0) edges.push({display:[a,b],idx:[a==='HEAD'?frame.head:m.idx[a],b==='HEAD'?frame.head:m.idx[b]],transferSeg:transfer,p,q});
      };
      for(let s=0;s<k;s++) add(s,s+1,!!m.transferSeg[s]);
      add(k,'HEAD',!!m.transferSeg[k]); add('HEAD',k+1,!!m.transferSeg[k]);
      for(let s=k+1;s<m.n-1;s++) add(s,s+1,!!m.transferSeg[s]);
      const maxDisplayStepM = Math.max(...Array.from({length:m.n-1},(_,s)=>m.transferSeg[s]?0:route.points[m.idx[s+1]].d-route.points[m.idx[s]].d));
      const maxProjectDelta = Math.max(...Array.from({length:m.n},(_,s)=>{
        const p=depth(m.lon[s],m.lat[s]), q=map.project([m.lon[s],m.lat[s]]);
        return Math.hypot(p.x-q.x,p.y-q.y);
      }));
      logs.push({durationSec,time,result,head:frame.head,displayCount:m.n,maxDisplayStepM,maxProjectDelta,edges,image:scene.canvas.toDataURL('image/png')});
      scene.destroy(); host.remove();
    }
    return logs;
  },readFileSync('public/samples/wahrier-reconstruction.gpx','utf8'));
  for(const f of facts) {
    writeFileSync(`${tmpdir()}/fix-line-${process.argv[2]??'before'}-${f.durationSec}.png`,Buffer.from(f.image.split(',')[1],'base64'));
    delete f.image; console.log(JSON.stringify(f));
  }
  writeFileSync(`${tmpdir()}/fix-line-${process.argv[2]??'before'}-facts.json`, JSON.stringify(facts, null, 2));
} finally { await browser.close(); }

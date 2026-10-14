// Кадры стилей в настоящем браузере: путешествие (и интро/финал) трёх стилей в 9:16 и 16:9, PNG в дизайн-размере.
//   npm run dev -- --port 5182 --strictPort        (в другом окне)
//   node tests/render/styles-frames.mjs <папка> [--only epic,atlas] [--formats 9x16] [--times 8,16,24] [--ratio 2] [--gpx файл.gpx] [--prefix имя]
// Сервер — RS_FRAMES_URL (по умолчанию http://localhost:5182/). Нужны Edge (RS_E2E_CHANNEL=chrome — Chrome) и интернет (тайлы).
// Скрипт сам грузит модули проекта через dev-сервер (import('/src/...')) и рисует настоящую сцену — без UI приложения.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const outDir = resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ?? resolve(root, 'node_modules/.cache/styles-frames'));
const URL_ = process.env.RS_FRAMES_URL ?? 'http://localhost:5182/';
const CHANNEL = process.env.RS_E2E_CHANNEL ?? 'msedge';
const styles = flag('only', 'epic,atlas,neon').split(',');
const formats = flag('formats', '9x16,16x9').split(',');
const times = flag('times', '8,16,24').split(',').map(Number);
const ratio = Number(flag('ratio', '2'));
const withEnds = flag('ends', '1') !== '0';
const gpxFile = flag('gpx', null);
const gpxText = gpxFile ? readFileSync(resolve(gpxFile), 'utf8') : null;
const prefix = flag('prefix', '');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: CHANNEL, headless: process.env.RS_E2E_HEADED !== '1', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const written = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror:', e.message, e.stack));
  await page.goto(URL_);
  await page.waitForTimeout(1500);

  for (const format of formats) {
    for (const styleId of styles) {
      const shots = await page.evaluate(async ({ format, styleId, times, ratio, withEnds, gpxText }) => {
        const [{ createScene }, { parseRouteText, buildRoute }, { enrichRoute }, { loadGeoData }, { buildTimeline }, { timelineOptionsFor }, { preloadOverlayAssets }] = await Promise.all([
          import('/src/render/scene.ts'), import('/src/route/index.ts'), import('/src/geo/index.ts'),
          import('/src/geo/load.ts'), import('/src/story/index.ts'), import('/src/render/layout.ts'), import('/src/render/assets.ts'),
        ]);
        const text = gpxText ?? await (await fetch('/samples/wahrier-reconstruction.gpx')).text();
        const parsed = parseRouteText('wahrier-reconstruction.gpx', text);
        const route = buildRoute(parsed.tracks);
        const geo = await loadGeoData('/');
        const enrichment = enrichRoute(route, geo);
        const fmt = format === '9x16' ? '9:16' : '16:9';
        const settings = {
          styleId, format: fmt, durationSec: 30, lang: 'ru', title: '', author: '@wahrier · реконструкция маршрута', showSafeZones: false,
          info: { distance: true, day: false, date: false, country: true, city: false, altitude: false, speed: false, profile: false, progress: true },
        };
        const timeline = buildTimeline(route, enrichment, settings, timelineOptionsFor(fmt, styleId));
        await preloadOverlayAssets(enrichment);
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000';
        document.body.append(host);
        const scene = await createScene(host, { format: fmt, styleId, pixelRatio: ratio });
        scene.setData(route, enrichment, settings, !gpxText);
        const D = timeline.durationSec;
        const list = [...times.map((t) => ['journey', t])];
        if (withEnds) list.unshift(['intro', 1.6]);
        if (withEnds) list.push(['outro', D - 0.1]);
        const out = [];
        for (const [name, t] of list) {
          const frame = timeline.frameAt(t);
          const { tilesComplete } = await scene.render(frame, { waitForTiles: true, timeoutMs: 40_000 });
          out.push({ name, t, act: frame.act, tilesComplete, png: scene.canvas.toDataURL('image/png') });
        }
        scene.destroy();
        host.remove();
        return out;
      }, { format, styleId, times, ratio, withEnds, gpxText });
      for (const s of shots) {
        const file = resolve(outDir, `${prefix}${styleId}-${format}-${s.name}-${String(Math.round(s.t)).padStart(2, '0')}.png`);
        writeFileSync(file, Buffer.from(s.png.split(',')[1], 'base64'));
        written.push(file);
        console.log(`${s.tilesComplete ? 'OK  ' : 'WARN'} ${file}${s.tilesComplete ? '' : ' (тайлы неполные)'}`);
      }
    }
  }
} finally {
  await browser.close();
}
console.log(`Готово: ${written.length} кадров → ${outDir}`);

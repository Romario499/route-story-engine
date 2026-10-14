// Снимки «до»: интерфейс (1440×900 и 390×844: пусто, пример загружен, шаг экспорта) и кадры
// готовых роликов exports/*.mp4 на 1, 15 и 29 с. Результат — docs/visual-review/before/*.png.
//   node scripts/visual-before.mjs
// Сайт: по умолчанию собирается и поднимается через vite preview (порт 4175).
// RS_BEFORE_URL=http://localhost:5173/ — снимать уже запущенный сервер (сборка не нужна).
// Нужны установленный Edge (или RS_E2E_CHANNEL=chrome) и интернет (тайлы карты). exports/*.mp4 только читаются.
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { openAndLoadSample } from '../tests/e2e/flow.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'docs/visual-review/before');
const exportsDir = resolve(root, 'exports');
const PORT = 4175;
const CHANNEL = process.env.RS_E2E_CHANNEL ?? 'msedge';
const VIEWPORTS = [
  { tag: '1440', width: 1440, height: 900 },
  { tag: '390', width: 390, height: 844 },
];
const VIDEOS = [
  { file: 'route-story-wahrier-9x16.mp4', tag: '9x16', css: [405, 720] },
  { file: 'route-story-wahrier-16x9.mp4', tag: '16x9', css: [720, 405] },
];
const VIDEO_TIMES = [1, 15, 29];

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Сервер ${url} не поднялся за ${ms / 1000} с`);
}

/** Ждёт, пока превью дорисует карту (исчезнет «Готовлю карту…») и подгрузятся тайлы. */
async function mapReady(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.preview__loading');
    return !el || el.hidden;
  }, undefined, { timeout: 60_000 });
  await page.waitForTimeout(2500);
}

/** Отдаёт файлы из exports/ по Range-запросам (для <video>), только чтение. */
function serveExports() {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0].slice(1));
    const file = resolve(exportsDir, name);
    if (!file.startsWith(exportsDir) || !name.endsWith('.mp4') || !existsSync(file)) { res.writeHead(404).end(); return; }
    const size = statSync(file).size;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': size });
      createReadStream(file).pipe(res);
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

mkdirSync(outDir, { recursive: true });

let preview = null;
let baseUrl = process.env.RS_BEFORE_URL;
if (!baseUrl) {
  const r = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`npm run build завершилась с кодом ${r.status}`);
  preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  baseUrl = `http://localhost:${PORT}/`;
}
const videoServer = await serveExports();
const videoPort = videoServer.address().port;

const written = [];
let browser;
try {
  await waitForServer(baseUrl, 30_000);
  browser = await chromium.launch({ channel: CHANNEL, headless: process.env.RS_E2E_HEADED !== '1', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  // ── интерфейс ──
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const shot = async (state) => {
      const path = resolve(outDir, `ui-${vp.tag}-${state}.png`);
      await page.screenshot({ path });
      written.push(path);
    };
    try {
      await page.goto(baseUrl);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      await shot('empty');

      await openAndLoadSample(page, baseUrl);
      await page.evaluate(() => document.fonts.ready);
      await mapReady(page);
      await shot('loaded');

      await page.getByTestId('export-slot').scrollIntoViewIfNeeded();
      await mapReady(page);
      await shot('export');
    } finally {
      await context.close();
    }
  }

  // ── кадры готовых роликов ──
  for (const v of VIDEOS) {
    const context = await browser.newContext({ viewport: { width: 800, height: 800 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    try {
      await page.setContent(`<body style="margin:0;background:#000"><video id="v" muted playsinline preload="auto" style="display:block;width:${v.css[0]}px;height:${v.css[1]}px" src="http://127.0.0.1:${videoPort}/${v.file}"></video></body>`);
      await page.waitForFunction(() => document.getElementById('v').readyState >= 2, undefined, { timeout: 30_000 });
      for (const t of VIDEO_TIMES) {
        await page.evaluate((time) => new Promise((ok) => {
          const el = document.getElementById('v');
          el.addEventListener('seeked', () => ok(), { once: true });
          el.currentTime = time;
        }), t);
        await page.waitForTimeout(400);
        const path = resolve(outDir, `video-${v.tag}-t${String(t).padStart(2, '0')}.png`);
        await page.locator('#v').screenshot({ path });
        written.push(path);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser) await browser.close();
  videoServer.close();
  if (preview) preview.kill();
}

let total = 0;
for (const p of written) { const s = statSync(p).size; total += s; console.log(`${p.slice(root.length + 1)}  ${(s / 1024).toFixed(0)} КБ`); }
console.log(`Итого: ${written.length} файлов, ${(total / 1048576).toFixed(2)} МБ (лимит 6 МБ)`);
if (total > 6 * 1048576) { console.error('Сумма больше 6 МБ'); process.exitCode = 1; }

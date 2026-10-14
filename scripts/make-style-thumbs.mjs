// Снимает образцы стилей для карточек выбора: кадр настоящего рендера (тот же Scene, что в превью и экспорте)
// на общем эталонном маршруте — примере @wahrier, формат 9:16, один и тот же момент путешествия — для каждого стиля.
//   node scripts/make-style-thumbs.mjs
// Результат: public/style-thumbs/{epic,atlas,neon}.webp (270×480, ≤ 150 КБ каждая).
// Сайт поднимается в режиме разработки (там есть window.__rs со сценой). RS_THUMBS_URL=http://localhost:5181/ —
// снимать уже запущенный dev-сервер. Нужны установленный Edge (или RS_E2E_CHANNEL=chrome) и интернет (тайлы карты).
import { spawn } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/style-thumbs');
const PORT = 5183;
const CHANNEL = process.env.RS_E2E_CHANNEL ?? 'msedge';
const STYLE_IDS = ['epic', 'atlas', 'neon'];
const THUMB = { width: 270, height: 480 };
const MAX_BYTES = 150 * 1024;
/** Момент путешествия — доля длительности: путь в разгаре, виден след и показатели. */
const MOMENT = 0.52;

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Сервер ${url} не поднялся за ${ms / 1000} с`);
}

mkdirSync(outDir, { recursive: true });

let server = null;
let baseUrl = process.env.RS_THUMBS_URL;
if (!baseUrl) {
  server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  baseUrl = `http://localhost:${PORT}/`;
}

const written = [];
let browser;
try {
  await waitForServer(baseUrl, 30_000);
  browser = await chromium.launch({ channel: CHANNEL, headless: process.env.RS_E2E_HEADED !== '1', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByTestId('load-sample').click();
  await page.getByTestId('route-summary').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => { const b = document.querySelector('[data-testid="play"]'); return Boolean(b) && !b.disabled; }, undefined, { timeout: 60_000 });
  // кнопка Play оживает раньше сцены: ждём саму сцену и конец «Готовлю карту…»
  await page.waitForFunction(() => Boolean(window.__rs?.scene && window.__rs?.timeline) && document.querySelector('.preview__loading')?.hidden !== false, undefined, { timeout: 90_000 });
  await page.getByTestId('format-9x16').click();
  await page.getByTestId('duration-30').click();
  await page.getByTestId('lang-ru').click();

  for (const id of STYLE_IDS) {
    await page.getByTestId(`style-${id}`).click();
    // пауза: чтобы цикл превью не перерисовал кадр поверх нашего
    if (await page.getByTestId('play').evaluate((el) => el.classList.contains('is-playing'))) await page.getByTestId('play').click();
    await page.waitForFunction((style) => document.querySelector(`[data-testid="style-${style}"]`)?.getAttribute('aria-pressed') === 'true', id);
    await page.waitForFunction(() => Boolean(window.__rs?.scene) && document.querySelector('.preview__loading')?.hidden !== false, undefined, { timeout: 90_000 });
    await page.waitForTimeout(1500); // setStyle и очередной кадр превью
    const dataUrl = await page.evaluate(async ({ moment, size, maxBytes }) => {
      const rs = window.__rs;
      if (!rs?.scene || !rs?.timeline) throw new Error('window.__rs недоступен: нужен режим разработки (vite dev)');
      const frame = rs.timeline.frameAt(rs.timeline.durationSec * moment);
      const res = await rs.scene.render(frame, { waitForTiles: true, timeoutMs: 25_000 });
      if (!res.tilesComplete) console.warn('тайлы догрузились не полностью');
      const src = rs.scene.canvas;
      const out = document.createElement('canvas');
      out.width = size.width; out.height = size.height;
      const ctx = out.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, size.width, size.height);
      let q = 0.86;
      let url = out.toDataURL('image/webp', q);
      while (url.length * 0.75 > maxBytes && q > 0.3) { q -= 0.06; url = out.toDataURL('image/webp', q); }
      return { url, tilesComplete: res.tilesComplete };
    }, { moment: MOMENT, size: THUMB, maxBytes: MAX_BYTES });
    const buf = Buffer.from(dataUrl.url.split(',')[1], 'base64');
    const file = resolve(outDir, `${id}.webp`);
    writeFileSync(file, buf);
    written.push({ file, tilesComplete: dataUrl.tilesComplete });
  }
  await context.close();
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}

let bad = false;
for (const w of written) {
  const size = statSync(w.file).size;
  console.log(`${w.file.slice(root.length + 1)}  ${(size / 1024).toFixed(0)} КБ${w.tilesComplete ? '' : '  (тайлы не полностью — переснимите)'}`);
  if (size > MAX_BYTES) bad = true;
}
if (bad) { console.error('Файл больше 150 КБ'); process.exitCode = 1; }

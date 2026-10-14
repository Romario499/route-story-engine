// Приёмка T28: только настоящий экспорт UI Edge; все материалы вне git.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { openAndLoadSample, configure } from './flow.ts';
import { restrictNetwork, reviewVideo, contactSheet } from './materials.mjs';

const out = resolve('private/t28/final-v3');
const url = 'http://localhost:5185/'; // dist: HMR не прерывает экспорт при ремонте исходников.
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const only = process.argv[2] ?? '';
const matrix = [
  ['triglav', '9x16', 30], ['sample', '9x16', 30], ['triglav', '16x9', 30],
  ['sample', '16x9', 30], ['triglav', '16x9', 60],
];
try {
  for (const [track, format, duration] of matrix) {
    const name = `${track}-${format}-${duration}`;
    if (only && !name.includes(only)) continue;
    const file = resolve(out, `${name}.mp4`);
    if (existsSync(file)) { console.log(`${name}: уже снят`); continue; }
    const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    await restrictNetwork(context);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', async msg => {
      if (msg.type() === 'warning' || msg.type() === 'error') {
        const values = await Promise.all(msg.args().map(a => a.jsonValue().catch(() => null)));
        errors.push(values);
      }
    });
    const facts = { name, edge: browser.version(), errors };
    try {
      if (track === 'sample') await openAndLoadSample(page, url);
      else {
        await page.goto(url);
        await page.getByTestId('file-input').setInputFiles(resolve('tracks/triglav.gpx'));
        await page.getByTestId('route-summary').waitFor({ timeout: 60000 });
      }
      await configure(page, { style: 'epic', format, duration, lang: 'ru' });
      if (await page.getByTestId('play').evaluate(el => el.classList.contains('is-playing'))) await page.getByTestId('play').click();
      const previewDir = resolve(out, `${name}-preview`); mkdirSync(previewDir, { recursive: true });
      for (const time of [2, 6, 10, 17, 20, 28]) {
        await page.getByTestId('seek').evaluate((el, { time, duration }) => {
          el.step = 'any'; el.value = String(time / duration * 1000);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }, { time, duration });
        await page.waitForTimeout(1000); // дать запросам кадра завершиться перед чтением превью
        const png = await page.getByTestId('preview-canvas').evaluate(c => c.toDataURL('image/png'));
        writeFileSync(resolve(previewDir, `${time}.png`), Buffer.from(png.split(',')[1], 'base64'));
      }
      await page.waitForFunction(() => !document.querySelector('[data-testid="export"]')?.disabled,
        undefined, { timeout: 60000 });
      facts.gpu = await page.evaluate(() => {
        const g = document.createElement('canvas').getContext('webgl');
        const ext = g?.getExtension('WEBGL_debug_renderer_info');
        return ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
      });
      const download = page.waitForEvent('download', { timeout: 360000 }); download.catch(() => {});
      const profiler = await context.newCDPSession(page);
      await profiler.send('Profiler.enable'); await profiler.send('Profiler.start');
      const started = performance.now();
      const progress = setInterval(async () => {
        console.log(name, Math.round((performance.now() - started) / 1000),
          await page.getByTestId('export-progress-text').textContent().catch(() => ''));
      }, 20000);
      await page.getByTestId('export').click();
      try { await page.getByTestId('export-done').or(page.getByTestId('export-error')).waitFor({ timeout: 360000 }); }
      finally { clearInterval(progress); }
      facts.seconds = (performance.now() - started) / 1000;
      const { profile } = await profiler.send('Profiler.stop');
      writeFileSync(resolve(out, `${name}-cpu.json`), JSON.stringify(profile));
      if (await page.getByTestId('export-error').isVisible()) throw new Error(await page.getByTestId('export-error').innerText());
      await (await download).saveAs(file);
      facts.seconds = (performance.now() - started) / 1000;
      console.log(JSON.stringify({ name, seconds: facts.seconds, errors }));
      await context.close();
      const dir = resolve(out, name);
      facts.review = await reviewVideo(browser, file, dir, [2, 6, 10, 17, 20, 28]);
      await contactSheet(browser, facts.review.shots.map(s => ({ label: `${name} ${s.t}s`, path: s.path })),
        resolve(dir, 'sheet.png'), 3, 480, format === '9x16' ? 854 : 270);
    } catch (e) {
      facts.failure = e.message;
      console.log(JSON.stringify(facts));
      await context.close();
    }
    writeFileSync(resolve(out, `${name}.json`), JSON.stringify(facts, null, 2) + '\n');
  }
} finally { await browser.close(); }

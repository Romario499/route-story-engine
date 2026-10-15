// Production build only: real UI import, confirmation, settings and seek. No dev hooks or source injection.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { configure } from './flow.ts';

const out = resolve(tmpdir(), 'camera-proof2');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true,
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], failures = [], shots = [];
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => { if (!r.url().startsWith('http://localhost:')) failures.push(new URL(r.url()).hostname); });
const ready = async () => {
  await page.waitForFunction(() => !document.querySelector('[data-testid="play"]')?.disabled
    && document.querySelector('.preview__loading')?.hidden !== false, null, { timeout: 90000 });
  const play = page.getByTestId('play');
  if (await play.evaluate(el => el.classList.contains('is-playing'))) await play.click();
};
try {
  await page.goto('http://localhost:5199/');
  await page.getByTestId('file-input').setInputFiles([process.env.RS_CAMERA_ROUTE, process.env.RS_CAMERA_CHAPTERS]);
  await page.getByTestId('route-summary').waitFor({ timeout: 90000 });
  await page.getByTestId('waypoint-order-confirmed').check();
  await ready();
  for (const format of ['9x16', '16x9']) {
    await configure(page, { style: 'epic', format, duration: 60, lang: 'ru' });
    await ready();
    for (const t of [3, 8, 12, 21, 30, 39, 48, 58]) {
      // Production preview doesn't expose scene.render(waitForTiles). Re-seek after tile loading.
      for (let pass = 0; pass < 3; pass++) {
        await page.getByTestId('seek').evaluate((el, t) => {
          el.step = 'any'; el.value = String(t / 60 * 1000); el.dispatchEvent(new Event('input', { bubbles: true }));
        }, t);
        await page.waitForTimeout(pass === 0 ? 4000 : 1200);
      }
      const png = await page.getByTestId('preview-canvas').evaluate(c => c.toDataURL('image/png'));
      const path = resolve(out, `${format}-${t}.png`);
      writeFileSync(path, Buffer.from(png.split(',')[1], 'base64'));
      shots.push({ format, t, path, seek: await page.getByTestId('seek').inputValue() });
      console.log(`captured ${format} ${t}s`);
    }
  }
  writeFileSync(resolve(out, 'visual.json'), JSON.stringify({ edge: browser.version(), errors, failedHosts: [...new Set(failures)], shots }, null, 2));
} finally { await browser.close(); }

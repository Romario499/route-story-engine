import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { organicArchive } from '../fixtures/synthetic/organic-archive';
import { inspectMp4 } from './mp4';

test('выбор участка блокирует превью и экспорт; период, коллекции и RU/EN доступны', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'synthetic.kml', mimeType: 'application/xml', buffer: Buffer.from(organicArchive()) });
  await expect(page.getByTestId('waypoint-selection')).toBeVisible();
  await expect(page.getByTestId('route-summary')).toHaveCount(0);
  await expect(page.getByTestId('preview-canvas')).toHaveCount(0);
  await expect(page.getByTestId('export')).toBeDisabled();
  await expect(page.getByTestId('waypoint-confirm')).toContainText('4 меток');
  await page.getByTestId('lang-en').click();
  await expect(page.getByTestId('waypoint-confirm')).toContainText('4 waypoints');
  await page.getByTestId('lang-ru').click();
  await page.getByTestId('waypoint-from').fill('2025-01-01');
  await page.getByTestId('waypoint-to').fill('2025-01-02');
  await page.getByTestId('waypoint-collection-1').uncheck();
  await expect(page.getByTestId('waypoint-confirm')).toContainText('2 меток, 2 мест ночёвок');
  await page.screenshot({ path: test.info().outputPath('selection.png'), fullPage: true });
  await page.getByTestId('waypoint-confirm').click();
  await expect(page.getByTestId('waypoint-composition')).toContainText('2 из 4');
  await expect(page.getByTestId('route-summary-line')).not.toContainText('дней');
  await expect(page.getByTestId('play')).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId('waypoint-reselect').click();
  // Прежнее подтверждённое превью сохраняется по контракту студии; новый участок ещё не построен и экспорт закрыт.
  await expect(page.getByTestId('export')).toBeDisabled();
  await expect(page.getByTestId('waypoint-to')).toHaveValue('2025-01-02');
  await page.getByTestId('waypoint-collection-0').uncheck();
  await page.getByTestId('waypoint-collection-1').check();
  await page.getByTestId('waypoint-from').fill('2026-10-11');
  await page.getByTestId('waypoint-to').fill('2026-10-12');
  await page.getByTestId('waypoint-confirm').click();
  await expect(page.getByTestId('waypoint-composition')).toContainText('2 из 4');
});

test('прочие цвета не теряются и включаются только явной галочкой; подтверждение порядка доступно в выборе и сводке', async ({ page }) => {
  await page.goto('/');
  const extras = ['brown', 'pink', 'blue'].map((color, i) => `<Placemark><styleUrl>#placemark-${color}</styleUrl><Point><coordinates>${3 + i},48</coordinates></Point></Placemark>`).join('');
  await page.getByTestId('file-input').setInputFiles({ name: 'synthetic.kml', mimeType: 'application/xml',
    buffer: Buffer.from(organicArchive().replace('</Document>', `${extras}</Document>`)) });
  await expect(page.getByTestId('waypoint-confirm')).toContainText('4 меток');
  await expect(page.getByTestId('waypoint-other-colors-count')).toHaveText('Не включено: 3 закладок других цветов');
  await expect(page.getByTestId('waypoint-other-colors')).not.toBeChecked();
  await expect(page.getByTestId('waypoint-order-confirmed')).not.toBeChecked();
  await page.getByTestId('waypoint-other-colors').check();
  await expect(page.getByTestId('waypoint-confirm')).toContainText('7 меток');
  await page.getByTestId('waypoint-other-colors').uncheck();
  await page.getByTestId('waypoint-order-confirmed').check();
  await page.getByTestId('lang-en').click();
  await expect(page.getByText('Bookmark creation order matches the trip route', { exact: true })).toBeVisible();
  await expect(page.getByTestId('waypoint-order-confirmed')).toBeChecked();
  await page.getByTestId('waypoint-confirm').click();
  await expect(page.getByTestId('waypoint-composition')).toContainText('4 of 7');
  await expect(page.getByTestId('waypoint-order-confirmed')).toBeChecked();
  await page.getByTestId('waypoint-order-confirmed').uncheck();
  await page.getByTestId('waypoint-reselect').click();
  await expect(page.getByTestId('waypoint-order-confirmed')).not.toBeChecked();
  await page.getByTestId('waypoint-other-colors').check();
  await page.getByTestId('waypoint-confirm').click();
  await expect(page.getByTestId('waypoint-composition')).toContainText('7 of 7');
});

interface Captures { texts: WeakMap<HTMLCanvasElement, string[]>; exports: Record<number, string[]>; frames: Record<number, number[]> }

for (const confirmed of [false, true]) test(`${confirmed ? 'подтверждённый порядок' : 'обзор'}: превью = экспорт на 2/10/20/28 с, декодированные MP4 обоих форматов`, async ({ page }) => {
  await page.addInitScript(() => {
    const captures: Captures = { texts: new WeakMap(), exports: {}, frames: {} };
    (window as unknown as { __t23: Captures }).__t23 = captures;
    const proto = CanvasRenderingContext2D.prototype;
    proto.drawImage = new Proxy(proto.drawImage, { apply(target, self: CanvasRenderingContext2D, args) {
      if (args[1] === 0 && args[2] === 0 && args[3] === self.canvas.width && args[4] === self.canvas.height) captures.texts.set(self.canvas, []);
      return Reflect.apply(target, self, args);
    } });
    proto.fillText = new Proxy(proto.fillText, { apply(target, self: CanvasRenderingContext2D, args) {
      if (self.globalAlpha > 0.004) captures.texts.get(self.canvas)?.push(String(args[0]));
      return Reflect.apply(target, self, args);
    } });
    window.VideoFrame = new Proxy(VideoFrame, { construct(target, args) {
      const timestamp = (args[1] as VideoFrameInit)?.timestamp;
      if (timestamp !== undefined && args[0] instanceof HTMLCanvasElement && [2, 4, 10, 20, 28].some(t => timestamp === t * 1e6)) {
        captures.exports[timestamp / 1e6] = [...(captures.texts.get(args[0]) ?? [])];
        const thumb = document.createElement('canvas'); thumb.width = 160; thumb.height = 160;
        const ctx = thumb.getContext('2d')!; ctx.drawImage(args[0], 0, 0, 160, 160);
        captures.frames[timestamp / 1e6] = Array.from(ctx.getImageData(0, 0, 160, 160).data);
      }
      return Reflect.construct(target, args);
    } });
  });
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'synthetic.kml', mimeType: 'application/xml', buffer: Buffer.from(organicArchive()) });
  await page.getByTestId('waypoint-selection').waitFor();
  if (confirmed) await page.getByTestId('waypoint-collection-1').uncheck();
  await page.getByTestId('waypoint-confirm').click();
  await expect(page.getByTestId('waypoint-order-confirmed')).not.toBeChecked();
  if (confirmed) await page.getByTestId('waypoint-order-confirmed').check();
  await page.getByTestId('style-atlas').click();
  for (const format of ['9x16', '16x9'] as const) {
    await page.getByTestId(`format-${format}`).click();
    await expect(page.getByTestId('play')).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId('preview-canvas')).toHaveAttribute('width', format === '9x16' ? '540' : '960');
    await expect(page.getByText('Готовлю карту…', { exact: true })).toBeHidden({ timeout: 60_000 });
    if (await page.getByTestId('play').evaluate(el => el.classList.contains('is-playing'))) await page.getByTestId('play').click();
    const preview: Record<number, string[]> = {};
    for (const t of [2, 4, 10, 20, 28]) {
      await page.getByTestId('seek').evaluate((el, time) => {
        const input = el as HTMLInputElement;
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]');
        if (canvas) (window as unknown as { __t23: Captures }).__t23.texts.set(canvas, []);
        input.step = 'any'; input.value = String(time / 30 * 1000); input.dispatchEvent(new Event('input', { bubbles: true }));
      }, t);
      await expect(page.getByTestId('timecode')).toContainText(`0:${String(t).padStart(2, '0')}`);
      await page.waitForFunction(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]');
        return canvas && ((window as unknown as { __t23: Captures }).__t23.texts.get(canvas)?.length ?? 0) > 0;
      });
      preview[t] = await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="preview-canvas"]')!;
        return [...((window as unknown as { __t23: Captures }).__t23.texts.get(canvas) ?? [])];
      });
      expect(preview[t].length).toBeGreaterThan(0);
      if (!confirmed) {
        expect(preview[t].join(' ')).not.toMatch(/Старт|Финиш|→/i);
        expect(preview[t].join(' ')).toMatch(/обзор по меткам/i);
        if (t === 4) {
          expect(preview[t]).toContain('2 страны');
          expect(preview[t].join(' ')).not.toMatch(/Франция|Австрия|Париж|Вена/);
        }
      } else if (t === 2 || t === 28) {
        expect(preview[t].some(text => /^Старт/i.test(text))).toBe(true);
        expect(preview[t].some(text => /^Финиш/i.test(text))).toBe(true);
      }
      await page.getByTestId('preview-canvas').screenshot({ path: test.info().outputPath(`preview-${format}-${t}.png`) });
    }
    const download = page.waitForEvent('download', { timeout: 180_000 });
    await page.getByTestId('export').click();
    const file = await download;
    const path = test.info().outputPath(`stage-a-${format}.mp4`);
    await file.saveAs(path);
    const { readFileSync } = await import('node:fs');
    const info = await inspectMp4(readFileSync(path));
    expect(info.samples).toBe(900);
    expect([info.width, info.height]).toEqual(format === '9x16' ? [1080, 1920] : [1920, 1080]);
    const exported = await page.evaluate(() => (window as unknown as { __t23: Captures }).__t23.exports);
    for (const t of [2, 4, 10, 20, 28]) expect(exported[t], `${format} t=${t}`).toEqual(preview[t]);
    // Проверяем уже декодированный MP4 и сохраняем полноценные кадры, а не только вход WebCodecs.
    const { writeFileSync } = await import('node:fs');
    for (const t of [2, 4, 10, 20, 28]) {
      const png = await page.getByTestId('export-video').evaluate(async (el, time) => {
        const video = el as HTMLVideoElement;
        video.pause();
        if (video.readyState < 2) await new Promise<void>(resolve => video.addEventListener('loadeddata', () => resolve(), { once: true }));
        await new Promise<void>(resolve => { video.addEventListener('seeked', () => resolve(), { once: true }); video.currentTime = time; });
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d')!.drawImage(video, 0, 0);
        const thumb = document.createElement('canvas'); thumb.width = 160; thumb.height = 160;
        const ctx = thumb.getContext('2d')!; ctx.drawImage(canvas, 0, 0, 160, 160);
        const decoded = ctx.getImageData(0, 0, 160, 160).data;
        const original = (window as unknown as { __t23: Captures }).__t23.frames[time];
        let error = 0;
        for (let i = 0; i < decoded.length; i++) if (i % 4 !== 3) error += Math.abs(decoded[i] - original[i]);
        return { width: canvas.width, height: canvas.height, data: canvas.toDataURL('image/png').split(',')[1],
          meanError: error / (160 * 160 * 3) };
      }, t);
      expect([png.width, png.height]).toEqual([info.width, info.height]);
      expect(png.meanError, `${format}/${t}: декодированный кадр соответствует входу кодека`).toBeLessThan(12);
      writeFileSync(test.info().outputPath(`export-${format}-${t}.png`), Uint8Array.from(atob(png.data), c => c.charCodeAt(0)));
    }
    await page.screenshot({ path: test.info().outputPath(`studio-${format}.png`), fullPage: true });
  }
});

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportAndDownload, openAndLoadSample, playPreviewBriefly } from './flow';
import { inspectMp4 } from './mp4';

const FIXTURE = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test.describe('сквозной сценарий', () => {
  test('пример → «Неон» → Play → экспорт 9:16 и 16:9, файлы валидны', async ({ page }) => {
    await openAndLoadSample(page, '/');
    await expect(page.getByTestId('route-summary')).toContainText('км');

    await page.getByTestId('style-neon').click();
    await expect(page.getByTestId('style-neon')).toHaveAttribute('aria-pressed', 'true');
    expect(await playPreviewBriefly(page)).toBe(true);

    await page.getByTestId('duration-15').click();

    // 9:16
    await page.getByTestId('format-9x16').click();
    const vertical = await exportAndDownload(page);
    expect(vertical.fileName).toMatch(/9x16\.(mp4|webm)$/);
    const v = await inspectMp4(vertical.data);
    expect(v.sizeBytes).toBeGreaterThan(100_000);
    expect([v.width, v.height]).toEqual([1080, 1920]);
    expect(v.samples).toBe(450);
    expect(Math.abs(v.durationSec - 15)).toBeLessThanOrEqual(0.2);

    // 16:9 (тот же маршрут и стиль)
    await page.getByTestId('format-16x9').click();
    const wide = await exportAndDownload(page);
    expect(wide.fileName).toMatch(/16x9\.(mp4|webm)$/);
    const w = await inspectMp4(wide.data);
    expect(w.sizeBytes).toBeGreaterThan(100_000);
    expect([w.width, w.height]).toEqual([1920, 1080]);
    expect(w.samples).toBe(450);
    expect(Math.abs(w.durationSec - 15)).toBeLessThanOrEqual(0.2);
  });

  test('битый файл показывает route-error и не ломает страницу', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles(FIXTURE('garbage.gpx'));
    const err = page.getByTestId('route-error');
    await expect(err).toBeVisible();
    await expect(err).not.toBeEmpty();

    // после ошибки хороший файл всё ещё загружается
    await page.getByTestId('file-input').setInputFiles({ name: 'ok.gpx', mimeType: 'application/gpx+xml', buffer: readFileSync(FIXTURE('track.gpx')) });
    await expect(page.getByTestId('route-summary')).toContainText('км');
  });
});

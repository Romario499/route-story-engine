import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { openAndLoadSample, playPreviewBriefly } from './flow';

declare const process: { env: Record<string, string | undefined> };

// Второй пример (участок по меткам @wahrier) живёт только в dev — файл лежит в private/ и в репозиторий не входит.
// В собранном сайте его нет; импорт выборки проверяем на обезличенной синтетике через обычный выбор файла.
const FIXTURE = fileURLToPath(new URL('../fixtures/synthetic/waypoint-sample.json', import.meta.url));

test.describe('участок по меткам', () => {
  test('dev-кнопка загружает синтетическую выборку, показатели подписаны и доступны по меткам', async ({ page }) => {
    // Изолированный worktree с node_modules-ссылкой: временный кэш задаётся только для своего прогона.
    const cacheDir = process.env.RS_T26_VITE_CACHE;
    const server = await createServer({ ...(cacheDir ? { configLoader: 'native', cacheDir } : {}), server: { host: '127.0.0.1', port: 5199, strictPort: true } });
    try {
      await server.listen();
      await page.route('**/private/wahrier/*.json', (route) => route.fulfill({ contentType: 'application/json', body: readFileSync(FIXTURE) }));
      await page.goto('http://127.0.0.1:5199/');
      await expect(page.getByTestId('load-sample')).toHaveText('Пример: маршрут @wahrier');
      await expect(page.getByTestId('waypoints-sample-note')).toHaveText('по меткам Organic Maps, не GPS-трек');
      await page.getByTestId('load-sample-waypoints').click();
      await expect(page.getByTestId('route-summary-line')).toHaveText(/^6\s+меток · 5\s+мест ночёвок$/);
      await expect(page.getByTestId('author-input')).toHaveValue('@wahrier');
      await expect(page.getByLabel('Места ночёвок', { exact: true })).toBeChecked();
      await expect(page.getByLabel('Метки', { exact: true })).toBeEnabled();
      await expect(page.getByTestId('info-distance')).toBeDisabled();
      await expect(page.getByTestId('info-speed')).toBeDisabled();
    } finally {
      await page.goto('about:blank');
      await server.close();
    }
  });

  test('прежний пример и его тексты не изменились, второй кнопки в сборке нет', async ({ page }) => {
    await page.goto('/');
    const sample = page.getByTestId('load-sample');
    await expect(sample).toHaveText('Пример: маршрут @wahrier');
    await expect(page.getByText('Реконструкция маршрута по афише (не GPS-запись).')).toBeVisible();
    await expect(page.getByTestId('load-sample-waypoints')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('private/');

    await openAndLoadSample(page, '/');
    await expect(page.getByTestId('route-summary-line')).toContainText('6 601 км');
    await expect(page.getByTestId('route-summary-line')).toContainText('расчётно');
    await expect(page.getByTestId('reconstruction-badge')).toHaveText('Реконструкция маршрута');
    await expect(page.getByTestId('waypoints-badge')).toHaveCount(0);
    await expect(page.getByTestId('author-input')).toHaveValue('@wahrier · реконструкция маршрута');
  });

  test('выборка по меткам: сводка без километража, пометка «не GPS-трек», показатели по меткам', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('file-input').setInputFiles({ name: 'waypoint-sample.json', mimeType: 'application/json', buffer: readFileSync(FIXTURE) });
    await page.getByTestId('route-summary').waitFor({ state: 'visible', timeout: 30_000 });

    const line = page.getByTestId('route-summary-line');
    await expect(line).toHaveText(/^6\s+меток · 5\s+мест ночёвок$/);
    await expect(line).not.toContainText('км');
    await expect(page.getByTestId('route-summary')).not.toContainText('Organic Maps Bookmarks');
    await expect(page.getByTestId('waypoints-badge')).toHaveText('По меткам Organic Maps, не GPS-трек');
    await expect(page.getByTestId('reconstruction-badge')).toHaveCount(0);
    await expect(page.getByTestId('waypoint-order-confirmed')).not.toBeChecked();
    await page.getByTestId('waypoint-order-confirmed').check();
    await expect(page.getByTestId('waypoint-order-confirmed')).toBeChecked();
    await page.getByTestId('waypoint-order-confirmed').uncheck();

    // заголовок и подпись пустые (оверлей возьмёт страну), километраж и высота выключены
    await expect(page.getByTestId('title-input')).toHaveValue('');
    await expect(page.getByTestId('author-input')).toHaveValue('');
    await expect(page.getByTestId('info-distance')).not.toBeChecked();
    await expect(page.getByTestId('info-progress')).toBeChecked();

    await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-testid="play"]')?.disabled, undefined, { timeout: 60_000 });
    expect(await playPreviewBriefly(page, 1500)).toBe(true);
    await expect(page.getByTestId('route-error')).toHaveCount(0);
  });
});

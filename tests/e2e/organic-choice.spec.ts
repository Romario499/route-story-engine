import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { organicMixed } from '../fixtures/synthetic/organic-mixed';
import { playPreviewBriefly } from './flow';

test('Organic Maps: выбор меток и трека перестраивает сводку, превью и экспорт без загрузки файла', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('file-input').setInputFiles({ name: 'synthetic.kml', mimeType: 'application/xml', buffer: Buffer.from(organicMixed()) });
  await expect(page.getByTestId('import-waypoints')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('route-summary-line')).toContainText('12 меток');
  await expect(page.getByTestId('route-summary-line')).not.toContainText('км');
  await expect(page.getByTestId('play')).toBeEnabled({ timeout: 60000 });
  expect(await playPreviewBriefly(page, 300)).toBe(true);
  await page.getByTestId('duration-15').click();
  await expect(page.getByTestId('export')).toBeEnabled();
  // При выборе другого источника превью и панель экспорта получают новый маршрут из store.
  await page.getByTestId('import-track').click();
  await expect(page.getByTestId('import-track')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('route-summary-line')).toContainText('км');
  await expect(page.getByTestId('info-distance')).toBeEnabled();
  await expect(page.getByTestId('play')).toBeEnabled({ timeout: 60000 });
  expect(await playPreviewBriefly(page, 300)).toBe(true);
  await expect(page.getByTestId('export')).toBeEnabled();
  await page.getByTestId('import-waypoints').click();
  await expect(page.getByTestId('route-summary-line')).toContainText('12 меток');
  await expect(page.getByTestId('info-distance')).toBeDisabled();
  await expect(page.getByTestId('play')).toBeEnabled({ timeout: 60000 });
  await expect(page.getByTestId('export')).toBeEnabled();
  await page.getByTestId('export').click();
  await expect(page.getByTestId('export-progress-text')).toContainText(/Кадры [1-9]\d* из 450/, { timeout: 60000 });
  await page.getByTestId('export-cancel').click();
  await expect(page.getByTestId('export-progress')).toHaveCount(0);
  await page.getByTestId('file-input').setInputFiles({ name: 'short.kml', mimeType: 'application/xml', buffer: Buffer.from(organicMixed(2)) });
  await expect(page.getByTestId('import-track')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('route-summary-line')).toContainText('км');
});

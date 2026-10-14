// Сценарий продукта через data-testid — общий для e2e-теста и для scripts/make-exports.mjs.
import type { Page } from '@playwright/test';

export type StyleId = 'epic' | 'neon' | 'atlas';
export type FormatId = '9x16' | '16x9';

export interface ExportOptions {
  style: StyleId;
  format: FormatId;
  duration: 15 | 30 | 45 | 60;
  lang: 'ru' | 'en';
}

export const EXPORT_TIMEOUT_MS = 6 * 60_000;

/** Открывает страницу и грузит встроенный пример; ждёт сводку маршрута. */
export async function openAndLoadSample(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.getByTestId('load-sample').click();
  await page.getByTestId('route-summary').waitFor({ state: 'visible', timeout: 60_000 });
  // Просмотр готов, когда кнопка Play стала доступной.
  await page.waitForFunction(() => {
    const btn = document.querySelector<HTMLButtonElement>('[data-testid="play"]');
    return Boolean(btn) && !btn!.disabled;
  }, undefined, { timeout: 60_000 });
}

export async function configure(page: Page, o: ExportOptions): Promise<void> {
  await page.getByTestId(`style-${o.style}`).click();
  await page.getByTestId(`format-${o.format}`).click();
  await page.getByTestId(`duration-${o.duration}`).click();
  await page.getByTestId(`lang-${o.lang}`).click();
}

/** Нажимает Play, даёт просмотру отыграть пару секунд и ставит на паузу. */
export async function playPreviewBriefly(page: Page, ms = 2500): Promise<boolean> {
  const play = page.getByTestId('play');
  // Автопредпросмотр может уже играть к моменту готовности карты: проверяем именно новый запуск по Play.
  if (await play.evaluate((el) => el.classList.contains('is-playing'))) await play.click();
  await play.click();
  const playing = await page.waitForFunction(
    () => document.querySelector('[data-testid="play"]')?.classList.contains('is-playing') ?? false,
    undefined, { timeout: 10_000 },
  ).then(() => true, () => false);
  await page.waitForTimeout(ms);
  if (await play.evaluate((el) => el.classList.contains('is-playing'))) await play.click();
  return playing;
}

/** Экспорт закончился «готово с предупреждением»: часть карты не загрузилась, файл не скачан. Повторить попытку — решает вызывающий. */
export class ExportWarningError extends Error {
  warning: string;
  constructor(warning: string) {
    super(`экспорт завершился с предупреждением: ${warning}`);
    this.name = 'ExportWarningError';
    this.warning = warning;
  }
}

/**
 * Жмёт «Экспортировать», ждёт `export-done` или `export-done-warning`, возвращает скачанный файл.
 * При предупреждении бросает `ExportWarningError` (файл с недогруженной картой сам не скачивается — ждать его нечего).
 */
export async function exportAndDownload(page: Page): Promise<{ fileName: string; data: Uint8Array }> {
  const downloadPromise = page.waitForEvent('download', { timeout: EXPORT_TIMEOUT_MS });
  downloadPromise.catch(() => {}); // при предупреждении загрузки не будет — это не «необработанный отказ»
  const exportBtn = page.getByTestId('export');
  await exportBtn.waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-testid="export"]')?.disabled, undefined, { timeout: 30_000 });
  await exportBtn.click();
  await page.getByTestId('export-progress').waitFor({ state: 'visible', timeout: 30_000 });
  const warning = page.getByTestId('export-done-warning');
  await page.getByTestId('export-done').or(warning).waitFor({ state: 'visible', timeout: EXPORT_TIMEOUT_MS });
  if (await warning.count()) {
    const text = (await warning.locator('.export-done__title').textContent()) ?? 'часть карты не успела загрузиться';
    throw new ExportWarningError(text.trim());
  }
  await page.getByTestId('download').waitFor({ state: 'visible' });
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk as Uint8Array);
  const data = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const p of parts) { data.set(p, offset); offset += p.byteLength; }
  return { fileName: download.suggestedFilename(), data };
}

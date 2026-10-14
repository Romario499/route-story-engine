// Надёжность экспорта в настоящем браузере (таск 14): сбой шрифта (история 115), этапы, предупреждения при закрытии
// и сворачивании, отмена без перезагрузки, повторное скачивание, перемотка готового файла.
import { expect, test, type Page } from '@playwright/test';
import { EXPORT_TIMEOUT_MS } from './flow';

/** Страница с примером; ждём сводку маршрута и готовую панель экспорта (кнопка доступна). */
async function openSample(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('load-sample').click();
  await page.getByTestId('route-summary').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByTestId('duration-15').click();
  await page.waitForFunction(
    () => { const b = document.querySelector<HTMLButtonElement>('[data-testid="export"]'); return Boolean(b) && !b!.disabled; },
    undefined, { timeout: 30_000 },
  );
}

/** Блоки, которые экспорт замораживает (inert): ни кликнуть, ни сфокусировать. */
const LOCKED = ['#step-route', '#step-style', '#step-content', '.transport', '.acts'];
/** Для каждого блока: есть ли inert; null — блока нет на странице (это тоже провал проверки). */
const inertOf = (page: Page) => page.evaluate((sels) => sels.map((s) => document.querySelector(s)?.hasAttribute('inert') ?? null), LOCKED);

/** Настоящий щелчок мышью по центру элемента: inert-элемент его не получает (программный el.click() обошёл бы блокировку). */
async function mouseClick(page: Page, testId: string): Promise<void> {
  const target = page.getByTestId(testId);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`нет рамки у ${testId}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * UI-01: основное действие видно в окне без прокрутки, липкая полоса экспорта не выше ~35 % окна.
 * Панель сама прокручивает себя в окно (scrollIntoView), поэтому сначала возвращаемся к сцене — страница и колонки
 * в начало, как после взгляда на превью или поворота экрана: действие должно остаться на экране (липкая полоса).
 */
async function expectActionOnScreen(page: Page, testIds: string[], label: string): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>('.stage, .rail').forEach((el) => { el.scrollTop = 0; });
  });
  await page.waitForTimeout(100);
  const m = await page.evaluate((ids) => ({
    h: window.innerHeight, w: window.innerWidth,
    boxes: ids.map((id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().toJSON() ?? null),
    slot: document.querySelector('[data-testid="export-slot"]')!.getBoundingClientRect().toJSON(),
  }), testIds);
  testIds.forEach((id, i) => {
    const box = m.boxes[i];
    expect(box, `${label}: нет ${id}`).not.toBeNull();
    expect(box.top, `${label}: ${id} выше окна`).toBeGreaterThanOrEqual(0);
    expect(box.bottom, `${label}: ${id} ниже окна (top ${Math.round(box.top)} при высоте ${m.h})`).toBeLessThanOrEqual(m.h);
    expect(box.right, `${label}: ${id} правее окна`).toBeLessThanOrEqual(m.w);
  });
  expect(m.slot.height, `${label}: липкая полоса экспорта ${Math.round(m.slot.height)} px при окне ${m.h}`).toBeLessThanOrEqual(m.h * 0.35);
}

const mapCanvasCount = (page: Page) => page.evaluate(() => document.querySelectorAll('canvas.maplibregl-canvas').length);

test.describe('надёжность экспорта', () => {
  test('файл шрифта недоступен (404): экспорт не стартует с «Повторить», после восстановления проходит', async ({ page }) => {
    await page.route(/manrope/i, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await openSample(page);

    await page.getByTestId('export').click();
    const error = page.getByTestId('export-error');
    await expect(error).toBeVisible({ timeout: 40_000 });
    await expect(error).toHaveAttribute('data-kind', 'font');
    await expect(error).toContainText('Не загрузился шрифт Manrope');
    await expect(error).toContainText('Повторить');
    await expect(page.getByTestId('export-retry')).toHaveText('Повторить');
    // экспорт не начинался: ни хода, ни блокировки настроек, ни готового ролика
    await expect(page.getByTestId('export-progress')).toHaveCount(0);
    await expect(page.getByTestId('export-done')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.exporting ?? null)).toBeNull();

    // повтор, пока файл всё ещё недоступен, — снова отказ, а не подмена шрифта
    await page.getByTestId('export-retry').click();
    await expect(page.getByTestId('export-error')).toHaveAttribute('data-kind', 'font', { timeout: 40_000 });
    await expect(page.getByTestId('export-done')).toHaveCount(0);

    // файл снова доступен → «Повторить» доводит экспорт до конца
    await page.unroute(/manrope/i);
    const download = page.waitForEvent('download', { timeout: EXPORT_TIMEOUT_MS });
    await page.getByTestId('export-retry').click();
    await expect(page.getByTestId('export-progress')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });
    expect((await download).suggestedFilename()).toMatch(/\.(mp4|webm)$/);
  });

  test('ход экспорта: этапы, один запуск, предупреждения; готовый файл перематывается и скачивается повторно', async ({ page }) => {
    await openSample(page);
    await page.getByTestId('export').click();

    const progress = page.getByTestId('export-progress');
    await expect(progress).toBeVisible({ timeout: 30_000 });
    // этапы «Подготовка → Кадры → Сборка файла»
    await expect(page.getByTestId('export-stages').locator('li')).toHaveText(['Подготовка', 'Кадры', 'Сборка файла']);
    await expect(progress).toHaveAttribute('data-stage', 'frames', { timeout: 60_000 });
    await expect(page.getByTestId('export-progress-text')).toContainText(/Кадры \d+ из 450/);
    // повторный запуск невозможен: кнопки «Экспортировать» нет, настройки заморожены
    await expect(page.getByTestId('export')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.exporting)).toBe('true');

    // закрытие страницы во время экспорта предупреждает
    const prevented = await page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    });
    expect(prevented).toBe(true);

    // свёрнутая вкладка: подсказка про замедление
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('export-tab-hidden')).toBeVisible();
    await expect(page.getByTestId('export-tab-hidden')).toHaveText('Вкладка свёрнута — экспорт может замедлиться');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByTestId('export-tab-hidden')).toBeHidden();

    // «Готово» — только после сборки файла, и стадия «Сборка файла» ему предшествует
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });
    await expect(page.getByTestId('export-done-warning')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.exporting ?? null)).toBeNull();
    // после экспорта beforeunload уже не вмешивается
    expect(await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; })).toBe(false);

    // файл перематывается
    const seek = await page.getByTestId('export-video').evaluate(async (el) => {
      const v = el as HTMLVideoElement;
      if (v.readyState < 1) await new Promise<void>((r) => v.addEventListener('loadedmetadata', () => r(), { once: true }));
      v.currentTime = 7.5;
      await new Promise<void>((r) => v.addEventListener('seeked', () => r(), { once: true }));
      return { duration: v.duration, currentTime: v.currentTime };
    });
    expect(Math.abs(seek.duration - 15)).toBeLessThan(0.3);
    expect(Math.abs(seek.currentTime - 7.5)).toBeLessThan(0.1);

    // «Скачать» работает повторно, ссылка не освобождается
    for (let i = 0; i < 2; i++) {
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
      const path = await download.path();
      expect(path).toBeTruthy();
      expect(await download.failure()).toBeNull();
    }
  });

  test('потеря контекста WebGL во время экспорта: понятная ошибка, ресурсы освобождены, повтор проходит до кадров', async ({ page }) => {
    await openSample(page);
    const canvasesBefore = await mapCanvasCount(page);
    await page.getByTestId('export').click();
    await expect(page.getByTestId('export-progress-text')).toContainText(/Кадры [1-9]\d* из 450/, { timeout: 60_000 });

    // «теряем» контекст у карты экспорта (самый большой холст карты: pixelRatio 2)
    const lost = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.maplibregl-canvas')).sort((a, b) => b.width - a.width);
      const gl = (canvases[0].getContext('webgl2') ?? canvases[0].getContext('webgl')) as WebGL2RenderingContext | null;
      const ext = gl?.getExtension('WEBGL_lose_context');
      ext?.loseContext();
      return Boolean(ext);
    });
    expect(lost).toBe(true);

    const error = page.getByTestId('export-error');
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toHaveAttribute('data-kind', 'webgl');
    await expect(error).toContainText('Повторите экспорт или перезагрузите страницу');
    await expect(page.getByTestId('export-retry')).toBeVisible();
    await expect(page.getByTestId('export-done')).toHaveCount(0);
    await expect.poll(() => mapCanvasCount(page), { timeout: 15_000 }).toBe(canvasesBefore);
    expect(await page.evaluate(() => document.documentElement.dataset.exporting ?? null)).toBeNull();

    // повтор запускает новый экспорт без перезагрузки страницы
    await page.getByTestId('export-retry').click();
    await expect(page.getByTestId('export-progress')).toHaveAttribute('data-stage', 'frames', { timeout: 60_000 });
    await page.getByTestId('export-cancel').click();
    await expect(page.getByTestId('export-cancelled')).toBeVisible({ timeout: 30_000 });
  });

  test('отмена освобождает ресурсы; следующий экспорт стартует без перезагрузки', async ({ page }) => {
    await openSample(page);
    const canvasesBefore = await mapCanvasCount(page);

    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByTestId('export').click();
      await expect(page.getByTestId('export-progress')).toHaveAttribute('data-stage', 'frames', { timeout: 60_000 });
      await expect(page.getByTestId('export-progress-text')).toContainText(/Кадры [1-9]\d* из 450/, { timeout: 60_000 });
      expect(await mapCanvasCount(page)).toBeGreaterThan(canvasesBefore); // скрытая сцена экспорта существует
      await page.getByTestId('export-cancel').click();
      await expect(page.getByTestId('export-cancelled')).toBeVisible({ timeout: 30_000 });
      // сцена экспорта уничтожена, настройки снова доступны, маршрут на месте
      await expect.poll(() => mapCanvasCount(page), { timeout: 15_000 }).toBe(canvasesBefore);
      expect(await page.evaluate(() => document.documentElement.dataset.exporting ?? null)).toBeNull();
      await expect(page.getByTestId('route-summary')).toContainText('км');
      await expect(page.getByTestId('export')).toBeEnabled();
    }
  });

  test('на время экспорта настройки заморожены (inert, клики не доходят), после отмены разморожены', async ({ page }) => {
    await openSample(page);
    expect(await inertOf(page)).toEqual(LOCKED.map(() => false));
    const neonBefore = await page.getByTestId('style-neon').getAttribute('aria-pressed');
    const wideBefore = await page.getByTestId('format-16x9').getAttribute('aria-pressed');

    await page.getByTestId('export').click();
    await expect(page.getByTestId('export-progress')).toHaveAttribute('data-stage', 'frames', { timeout: 60_000 });
    expect(await inertOf(page)).toEqual(LOCKED.map(() => true));
    await mouseClick(page, 'style-neon');
    await mouseClick(page, 'format-16x9');
    await expect(page.getByTestId('style-neon')).toHaveAttribute('aria-pressed', neonBefore ?? 'false');
    await expect(page.getByTestId('format-16x9')).toHaveAttribute('aria-pressed', wideBefore ?? 'false');

    await page.getByTestId('export-cancel').click();
    await expect(page.getByTestId('export-cancelled')).toBeVisible({ timeout: 30_000 });
    expect(await inertOf(page)).toEqual(LOCKED.map(() => false));
    // разморожено по-настоящему: щелчок снова меняет стиль
    await mouseClick(page, 'style-neon');
    await expect(page.getByTestId('style-neon')).toHaveAttribute('aria-pressed', 'true');
  });

  test('после ошибки inert снят', async ({ page }) => {
    await page.route(/manrope/i, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await openSample(page);
    await page.getByTestId('export').click();
    await expect(page.getByTestId('export-error')).toBeVisible({ timeout: 40_000 });
    expect(await inertOf(page)).toEqual(LOCKED.map(() => false));
  });

  test.describe('телефон 390×844', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('после готового ролика второй экспорт доходит до «готово», inert снят', async ({ page }) => {
      await openSample(page);
      for (let run = 1; run <= 2; run++) {
        const button = page.getByTestId('export');
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeEnabled();
        await button.click();
        await expect(page.getByTestId('export-progress')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('export-done'), `экспорт №${run}`).toBeVisible({ timeout: EXPORT_TIMEOUT_MS });
        expect(await inertOf(page)).toEqual(LOCKED.map(() => false));
        // UI-01: «Скачать» и второй экспорт — в окне без прокрутки
        await expectActionOnScreen(page, ['download', 'export'], `готово №${run}`);
      }
    });
  });

  test.describe('телефон 360×740: основное действие в окне после отмены и ошибки (UI-01)', () => {
    test.use({ viewport: { width: 360, height: 740 } });

    test('после отмены «Экспортировать» в окне без прокрутки', async ({ page }) => {
      await openSample(page);
      await page.getByTestId('export').click();
      await expect(page.getByTestId('export-progress')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('export-cancel').click();
      await expect(page.getByTestId('export-cancelled')).toBeVisible({ timeout: 30_000 });
      await expectActionOnScreen(page, ['export'], 'отмена');
    });

    test('после ошибки «Повторить» в окне без прокрутки', async ({ page }) => {
      await page.route(/manrope/i, (route) => route.fulfill({ status: 404, body: 'not found' }));
      await openSample(page);
      await page.getByTestId('export').click();
      await expect(page.getByTestId('export-error')).toBeVisible({ timeout: 40_000 });
      await expectActionOnScreen(page, ['export-retry'], 'ошибка');
    });
  });
});

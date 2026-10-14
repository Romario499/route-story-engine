import { expect, test } from '@playwright/test';
import { openAndLoadSample } from './flow';

// Студия V3 (истории 131–132): раскладка по размерам окна, экспорт на виду, полоса актов, никаких «фальшивых» функций.
const SIZES = [
  { w: 1440, h: 900, wide: true }, { w: 1024, h: 768, wide: false }, { w: 390, h: 844, wide: false }, { w: 360, h: 740, wide: false },
];

for (const { w, h, wide } of SIZES) {
  test(`раскладка ${w}×${h}: без горизонтальной прокрутки, экспорт виден без прокрутки`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openAndLoadSample(page, '/');
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      exp: document.querySelector('[data-testid="export"]')!.getBoundingClientRect().toJSON(),
    }));
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.exp.top).toBeGreaterThanOrEqual(0);
    expect(m.exp.bottom).toBeLessThanOrEqual(h);
    if (wide) {
      // 1440: стиль, формат, длительность и язык — в правой колонке без прокрутки
      for (const id of ['style-epic', 'style-atlas', 'format-9x16', 'format-16x9', 'duration-30', 'lang-ru']) {
        const box = await page.getByTestId(id).boundingBox();
        expect(box, id).not.toBeNull();
        expect(box!.y + box!.height, id).toBeLessThanOrEqual(h);
      }
    }
  });
}

test('полоса актов: из Timeline, клик — к началу акта; без 4K/Pro/музыки', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAndLoadSample(page, '/');
  await expect(page.getByTestId('act-intro')).toBeVisible();
  await page.getByTestId('duration-30').click();
  const play = page.getByTestId('play');
  if (await play.evaluate((el) => el.classList.contains('is-playing'))) await play.click();
  await page.getByTestId('act-journey').click();
  await expect(page.getByTestId('timecode')).toContainText('0:03 / 0:30');
  await page.getByTestId('act-outro').click();
  await expect(page.getByTestId('timecode')).toContainText('0:26 / 0:30');
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const bad of ['4k', 'pro', 'музык', 'озвучк', 'сцена 2']) expect(text, bad).not.toContain(bad);
});

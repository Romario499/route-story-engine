import { expect, test } from '@playwright/test';
import { openAndLoadSample } from './flow';

test('V3: якоря, готовность и автоматические сцены управляют настоящим превью', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('nav-route')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('nav-scenes')).toHaveAttribute('data-ready', 'false');
  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('scene-country').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('nav-scenes')).toHaveAttribute('data-ready', 'true');
  await page.getByTestId('nav-style').click();
  await expect(page.getByTestId('nav-style')).toHaveAttribute('aria-current', 'step');
  const play = page.getByTestId('play');
  if (await play.evaluate(el => el.classList.contains('is-playing'))) await play.click();
  const scene = page.getByTestId('scene-country').first();
  const at = Number(await scene.getAttribute('data-time'));
  await scene.click();
  await expect.poll(async () => Number(await page.getByTestId('seek').inputValue())).toBeCloseTo(at / 30 * 1000, 0);
  await expect(scene.locator('canvas')).toHaveAttribute('data-captured', 'true');
});

for (const [width, height] of [[1440, 900], [1024, 768]] as const) {
  test(`V3 ${width}: основные действия доступны без прокрутки`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openAndLoadSample(page, '/');
    for (const id of ['replace-file', 'style-epic', 'style-neon', 'style-atlas', 'format-9x16', 'format-16x9', 'restart', 'export']) {
      const box = await page.getByTestId(id).boundingBox();
      expect(box, id).not.toBeNull();
      expect(box!.y, id).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, id).toBeLessThanOrEqual(height);
      expect(await page.getByTestId(id).evaluate(el => {
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return top === el || el.contains(top);
      }), `${id} не перекрыт панелью`).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
  });
}

import { expect, test } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const sample = readFileSync(fileURLToPath(new URL('../fixtures/synthetic/waypoint-sample.json', import.meta.url)));
const chapters = [{ id:'fiction',title:{ru:'Выдуманная глава',en:'Fictional chapter'},text:{ru:'Выдуманная история для теста.',en:'A fictional story for testing.'},anchor:{countries:['TR']},source:'traveler',mood:'rain' }];
test('маршрут и главы одним выбором: совпавшая глава без редактора, неверный файл — готовое превью без глав', async ({page}) => {
 await page.goto('/');
 await page.getByTestId('file-input').setInputFiles([{name:'waypoints.json',mimeType:'application/json',buffer:sample},{name:'chapters.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(chapters))}]);
 await expect(page.getByTestId('chapters-badge')).toHaveText('Главы: 1 · со слов путешественника');
 await expect(page.getByTestId('info-city')).toBeChecked();
 await expect(page.getByTestId('play')).toBeEnabled({timeout:60000});
 await expect(page.getByTestId('chapter-editor')).toHaveCount(0);
 await page.getByTestId('file-input').setInputFiles([{name:'waypoints.json',mimeType:'application/json',buffer:sample},{name:'chapters.json',mimeType:'application/json',buffer:Buffer.from('{')}]);
 await expect(page.getByTestId('route-summary')).toContainText('Неверный файл глав');
 await expect(page.getByTestId('chapters-badge')).toHaveCount(0);
 await expect(page.getByTestId('play')).toBeEnabled({timeout:60000});
});

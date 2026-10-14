import { expect, it } from 'vitest';
import { parseRouteFiles } from '../../src/route';
import track from '../fixtures/track.gpx?raw';
const file = (name: string, body: string) => ({ name, arrayBuffer: async () => new TextEncoder().encode(body).buffer }) as File;
export const chapter = { id: 'fiction', title: { ru: 'Синтетическая история', en: 'Fictional chapter' }, text: { ru: 'Синтетическая история.', en: 'A fictional story.' }, source: 'traveler', mood: 'rain', anchor: { countries: ['AA'], markedAt: { from: 0, to: 2000000000000 } } };
it('chapter import and invalid chapter recovery', async () => {
  const result = await parseRouteFiles([file('track.gpx', track), file('chapters.json', JSON.stringify([chapter]))]);
  expect(result.ok).toBe(true);
  expect(result).toHaveProperty('chapters', [chapter]);
  if (result.ok) expect(result.tracks).toHaveLength(1);
  for (const bad of ['{', JSON.stringify([{ ...chapter, media: [] }]), JSON.stringify([{ ...chapter, anchor: { countries: ['AA'], markedAt: { from: 5, to: 1 } } }])]) {
    const parsed = await parseRouteFiles([file('track.gpx', track), file('chapters.json', bad)]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) { expect(parsed.warnings.join(' ')).toContain('глав'); expect(parsed).not.toHaveProperty('chapters'); }
  }
});

it('несколько файлов глав проверяются как единый набор, повтор id отключает главы, маршрут остаётся', async () => {
  const parsed = await parseRouteFiles([file('track.gpx', track), file('first.json', JSON.stringify([chapter])), file('second.json', JSON.stringify([chapter]))]);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) {
    expect(parsed.tracks).toHaveLength(1);
    expect(parsed).not.toHaveProperty('chapters');
    expect(parsed.warnings.join(' ')).toContain('Неверный файл глав');
  }
});

it('ошибка чтения файла глав сохраняет доступный маршрут без глав', async () => {
  const broken = { name: 'chapters.json', arrayBuffer: async () => { throw new Error('unavailable'); } } as unknown as File;
  const parsed = await parseRouteFiles([file('track.gpx', track), broken]);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) { expect(parsed.tracks).toHaveLength(1); expect(parsed.warnings.join(' ')).toContain('Неверный файл глав'); expect(parsed).not.toHaveProperty('chapters'); }
});

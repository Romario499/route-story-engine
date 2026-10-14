import { describe, expect, it } from 'vitest';
import { createAbortError, estimateEtaSec, exportFileName, formatEta, formatFileSize, isAbortError } from '../../src/export/util';

describe('exportFileName', () => {
  it('route-story_<заголовок>_<формат>.<расширение>', () => {
    expect(exportFileName('Хива и Бухара', '9:16', 'mp4')).toBe('route-story_Хива-и-Бухара_9x16.mp4');
    expect(exportFileName('Silk Road 2024', '16:9', 'webm')).toBe('route-story_Silk-Road-2024_16x9.webm');
  });
  it('убирает символы, запрещённые в именах файлов, и пустой заголовок заменяет', () => {
    expect(exportFileName('a/b\\c:d*?"<>|e', '9:16', 'mp4')).toBe('route-story_a-b-c-d-e_9x16.mp4');
    expect(exportFileName('   ', '9:16', 'mp4')).toBe('route-story_route_9x16.mp4');
  });
  it('длинный заголовок обрезается', () => {
    const name = exportFileName('я'.repeat(200), '16:9', 'mp4');
    expect(name.length).toBeLessThan(70);
    expect(name.endsWith('_16x9.mp4')).toBe(true);
  });
});

describe('estimateEtaSec', () => {
  it('до 5 кадров оценки нет', () => { expect(estimateEtaSec(3, 450, 3000)).toBeNull(); });
  it('по среднему темпу: 100 кадров за 20 с, осталось 350 → 70 с', () => { expect(estimateEtaSec(100, 450, 20_000)).toBe(70); });
  it('в конце — 0', () => { expect(estimateEtaSec(450, 450, 90_000)).toBe(0); });
});

describe('форматы', () => {
  it('размер файла', () => {
    expect(formatFileSize(512)).toBe('1 КБ');
    expect(formatFileSize(150 * 1024)).toBe('150 КБ');
    expect(formatFileSize(18.46 * 1024 * 1024)).toBe('18,5 МБ');
  });
  it('оставшееся время', () => {
    expect(formatEta(45)).toBe('45 с');
    expect(formatEta(65)).toBe('1 мин 05 с');
  });
  it('ошибка отмены распознаётся', () => {
    expect(isAbortError(createAbortError())).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});

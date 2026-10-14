// Чистые помощники экспорта: имя файла, оценка оставшегося времени, размер, ошибка отмены.
import type { Format } from '../types';

/** Часть заголовка, пригодная для имени файла: буквы любых алфавитов и цифры, остальное — дефис. */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug || 'route';
}

/** `route-story_<заголовок>_<9x16|16x9>.<ext>` */
export function exportFileName(title: string, format: Format, ext: 'mp4' | 'webm'): string {
  return `route-story_${slugifyTitle(title)}_${format === '9:16' ? '9x16' : '16x9'}.${ext}`;
}

/** Оставшееся время по среднему темпу; пока кадров мало — null (оценка прыгала бы). */
export function estimateEtaSec(done: number, total: number, elapsedMs: number, minFrames = 5): number | null {
  if (done < minFrames || done >= total || elapsedMs <= 0) return done >= total ? 0 : null;
  return Math.max(0, Math.round(((elapsedMs / done) * (total - done)) / 1000));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`;
}

/** «1 мин 05 с» / «45 с» */
export function formatEta(sec: number): string {
  if (sec < 60) return `${sec} с`;
  return `${Math.floor(sec / 60)} мин ${String(sec % 60).padStart(2, '0')} с`;
}

export function createAbortError(): DOMException {
  return new DOMException('Экспорт отменён', 'AbortError');
}

export function isAbortError(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { name?: string }).name === 'AbortError';
}

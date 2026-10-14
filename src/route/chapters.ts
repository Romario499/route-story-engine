import type { Chapter } from '../types';

export const CHAPTER_FILE_ERROR = 'Неверный файл глав: нужен JSON-массив Chapter[] по схеме samples/chapters.schema.json. Ролик продолжится без глав.';
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const localized = (v: unknown, max: number) => obj(v) && keys(v, ['ru', 'en']) && ['ru', 'en'].every((k) => typeof v[k] === 'string' && (v[k] as string).trim().length > 0 && (v[k] as string).length <= max);
/** null — другой JSON; ошибка не содержит личных текстов или координат. */
export function parseChapterFile(fileName: string, text: string): { chapters: Chapter[] } | { error: string } | null {
  const named = /(?:^|[.-])chapters(?:[.-].*)?\.json$/i.test(fileName) || /^chapters\.json$/i.test(fileName);
  let root: unknown;
  try { root = JSON.parse(text); } catch { return named ? { error: CHAPTER_FILE_ERROR } : null; }
  if (!named && !Array.isArray(root)) return null;
  if (!Array.isArray(root) || root.length > 64) return { error: CHAPTER_FILE_ERROR };
  const ids = new Set<string>();
  let finales = 0;
  for (const c of root) {
    if (!obj(c) || !keys(c, ['id', 'title', 'text', 'anchor', 'mood', 'source', 'finale'])
      || typeof c.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(c.id) || ids.has(c.id)
      || !localized(c.title, 72) || !localized(c.text, 160) || c.source !== 'traveler'
      || !['cold', 'heat', 'rain', 'altitude', 'warmth', 'neutral'].includes(String(c.mood))
      || (c.finale !== undefined && typeof c.finale !== 'boolean')) return { error: CHAPTER_FILE_ERROR };
    ids.add(c.id);
    if (c.finale && ++finales > 1) return { error: CHAPTER_FILE_ERROR };
    const a = c.anchor;
    if (!obj(a) || !keys(a, ['countries', 'region', 'markedAt']) || !Array.isArray(a.countries) || !a.countries.length || !a.countries.every((x) => typeof x === 'string' && /^[A-Z]{2}$/.test(x))) return { error: CHAPTER_FILE_ERROR };
    if (a.markedAt !== undefined && (!obj(a.markedAt) || !keys(a.markedAt, ['from', 'to']) || !finite(a.markedAt.from) || !finite(a.markedAt.to) || a.markedAt.from > a.markedAt.to)) return { error: CHAPTER_FILE_ERROR };
    if (a.region !== undefined) {
      const r = a.region;
      if (!obj(r) || !keys(r, ['name', 'bbox']) || typeof r.name !== 'string' || !r.name.trim() || !Array.isArray(r.bbox) || r.bbox.length !== 4 || !r.bbox.every(finite)) return { error: CHAPTER_FILE_ERROR };
      const [w, s, e, n] = r.bbox as number[];
      if (w < -180 || e > 180 || s < -90 || n > 90 || w > e || s > n) return { error: CHAPTER_FILE_ERROR };
    }
  }
  return { chapters: root as Chapter[] };
}

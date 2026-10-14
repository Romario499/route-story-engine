// Чтение выбранных файлов: декодирование текста и склейка результатов разбора.
import type { Chapter, ParseResult, RawTrack } from '../types';
import { CHAPTER_FILE_ERROR, parseChapterFile } from './chapters';
import { ROUTE_ERRORS, RouteParseError } from './errors';
import { parseRouteText } from './parse';
import { parseKmz } from './kmz';
import type { KmzOptions } from './kmz';
import { summarizeKmlImport } from './waypoints';

/** UTF-8, а если в тексте битые символы — windows-1251 (CSV из русского Excel). */
function decode(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1251').decode(buf);
  } catch {
    return utf8;
  }
}

export async function parseRouteFiles(files: File[], options: KmzOptions = {}): Promise<ParseResult> {
  if (!files.length) return { ok: false, error: ROUTE_ERRORS.empty };
  const tracks: RawTrack[] = [];
  const warnings: string[] = [];
  let chapters: Chapter[] = [];
  let chapterError = false;
  for (const file of files) {
    let text: string;
    try {
      const bytes = await file.arrayBuffer();
      if (/\.kmz$/i.test(file.name)) {
        tracks.push(...await parseKmz(file.name, new Uint8Array(bytes), options));
        continue;
      }
      text = decode(bytes);
    } catch (e) {
      const chapterFile = /\.json$/i.test(file.name) ? parseChapterFile(file.name, '') : null;
      if (chapterFile && 'error' in chapterFile) {
        warnings.push(CHAPTER_FILE_ERROR); chapterError = true; continue;
      }
      const error = e instanceof RouteParseError ? e.message : ROUTE_ERRORS.unreadable('файл повреждён или недоступен');
      return { ok: false, error: files.length > 1 ? `${file.name}: ${error}` : error };
    }
    const chapterFile = /\.json$/i.test(file.name) ? parseChapterFile(file.name, text) : null;
    if (chapterFile) {
      if ('error' in chapterFile) { warnings.push(chapterFile.error); chapterError = true; }
      else chapters.push(...chapterFile.chapters);
      continue;
    }
    const r = parseRouteText(file.name, text);
    if (!r.ok) return { ok: false, error: files.length > 1 ? `${file.name}: ${r.error}` : r.error };
    tracks.push(...r.tracks);
    warnings.push(...r.warnings);
  }
  // Ограничения схемы действуют на весь выбор, а не отдельно на каждый файл.
  if (chapters.length && !chapterError) {
    const combined = parseChapterFile('chapters.json', JSON.stringify(chapters));
    if (combined && 'error' in combined) { warnings.push(CHAPTER_FILE_ERROR); chapterError = true; }
  }
  return { ok: true, tracks, warnings, ...(!chapterError && chapters.length ? { chapters } : {}), ...(tracks.some((t) => t.kmlImport) ? { report: summarizeKmlImport(tracks).report } : {}) };
}

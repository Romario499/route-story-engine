// Разбор времени из файлов треков → epoch ms (UTC). Невалидное время → undefined.

const DMY = /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?$/;
const ISO_NO_ZONE = /^\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/** Число: секунды или миллисекунды эпохи (по величине). */
function fromNumber(n: number): number | undefined {
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // < 1e11 — это секунды (до 5138 года), иначе миллисекунды
  return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
}

export function parseTime(value: unknown): number | undefined {
  if (typeof value === 'number') return fromNumber(value);
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return fromNumber(Number(s));

  const dmy = DMY.exec(s);
  if (dmy) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0', frac = ''] = dmy;
    if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return undefined;
    const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
    const t = Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss, ms);
    return Number.isFinite(t) ? t : undefined;
  }

  // «2024-05-01 10:00:00» без часового пояса считаем UTC, а не локальным временем браузера
  const iso = ISO_NO_ZONE.test(s) ? `${s.replace(' ', 'T')}Z` : s;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

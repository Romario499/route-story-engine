// Предупреждение «Заголовок слишком длинный для кадра» (история 67).
// Измерение и перенос — в оверлее ролика (`src/render/overlay.ts`): превью, экспорт и предупреждение считают одним кодом.
export { titleFits } from '../../render/overlay';

type FitsResult = boolean | { fits: boolean; maxChars?: number };

/**
 * Если заголовок не помещается — сколько символов (по началу строки) ещё помещается; иначе null.
 * `fits` может вернуть boolean или `{ fits, maxChars }` (так отвечает `titleFits`): во втором случае берётся готовое
 * `maxChars` — повторный поиск не нужен. `fits` монотонна: чем короче строка, тем больше шанс, что она поместится.
 */
export function titleFitIssue(title: string, fits: (candidate: string) => FitsResult): { maxChars: number } | null {
  const text = title.trim();
  if (!text) return null;
  const whole = fits(text);
  if (typeof whole === 'object') {
    if (whole.fits) return null;
    if (typeof whole.maxChars === 'number') return { maxChars: whole.maxChars };
  } else if (whole) {
    return null;
  }
  const ok = (c: string): boolean => {
    const r = fits(c);
    return typeof r === 'boolean' ? r : r.fits;
  };
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(text.slice(0, mid).trimEnd())) lo = mid; else hi = mid - 1;
  }
  return { maxChars: lo };
}

export function titleWarningText(maxChars: number): string {
  return maxChars > 0
    ? `Заголовок слишком длинный для кадра — сократите до ${maxChars} символов.`
    : 'Заголовок слишком длинный для кадра — сократите его.';
}

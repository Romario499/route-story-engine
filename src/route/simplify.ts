// Упрощение линии для отрисовки: Дуглас—Пекер (итеративный) в плоскости Меркатора.

/**
 * Возвращает отсортированные индексы точек, которые остаются при допуске eps.
 * ranges — непрерывные куски (между переездами); концы каждого куска сохраняются всегда.
 */
function douglasPeucker(xs: Float64Array, ys: Float64Array, ranges: [number, number][], eps: number, keep: Uint8Array): number {
  keep.fill(0);
  const eps2 = eps * eps;
  const stack: number[] = [];
  let count = 0;
  for (const [a, b] of ranges) {
    if (!keep[a]) { keep[a] = 1; count++; }
    if (!keep[b]) { keep[b] = 1; count++; }
    if (b - a > 1) stack.push(a, b);
    while (stack.length) {
      const last = stack.pop()!;
      const first = stack.pop()!;
      const ax = xs[first], ay = ys[first];
      const dx = xs[last] - ax, dy = ys[last] - ay;
      const len2 = dx * dx + dy * dy;
      let maxD = -1;
      let maxI = -1;
      for (let i = first + 1; i < last; i++) {
        let px = xs[i] - ax, py = ys[i] - ay;
        if (len2 > 0) {
          const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
          px -= t * dx; py -= t * dy;
        }
        const d2 = px * px + py * py;
        if (d2 > maxD) { maxD = d2; maxI = i; }
      }
      if (maxD > eps2 && maxI > 0) {
        keep[maxI] = 1; count++;
        if (maxI - first > 1) stack.push(first, maxI);
        if (last - maxI > 1) stack.push(maxI, last);
      }
    }
  }
  return count;
}

/** Индексы для отрисовки: не больше maxPoints (концы кусков сохраняются всегда). */
export function simplifyIndices(xs: Float64Array, ys: Float64Array, ranges: [number, number][], maxPoints: number): number[] {
  const n = xs.length;
  if (n <= maxPoints) return Array.from({ length: n }, (_, i) => i);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  const extent = Math.max(maxX - minX, maxY - minY, 1e-12);
  const keep = new Uint8Array(n);
  let eps = extent * 2e-5;
  // удваиваем допуск, пока не уложимся в бюджет
  for (let guard = 0; guard < 60; guard++) {
    if (douglasPeucker(xs, ys, ranges, eps, keep) <= maxPoints) break;
    eps *= 2;
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

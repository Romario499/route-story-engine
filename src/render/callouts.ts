import type { Rect } from './layout';
import { waypointLineIntersects } from './waypoint-layer';

/** Общая точка маршрута и выноски допустима; пересечение дальше от якоря — нет. */
function crossesLeader(a: { x: number; y: number }, b: { x: number; y: number }, s: number[]): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, sx = s[2] - s[0], sy = s[3] - s[1];
  const cross = dx * sy - dy * sx, ox = s[0] - a.x, oy = s[1] - a.y;
  if (Math.abs(cross) < 1e-8) {
    if (Math.abs(ox * dy - oy * dx) > 1e-6) return false;
    const d2 = dx * dx + dy * dy;
    if (!d2) return false;
    const ts = [ox * dx + oy * dy, (s[2] - a.x) * dx + (s[3] - a.y) * dy].map(v => v / d2);
    return Math.min(...ts) < 1 && Math.max(...ts) > 0.001;
  }
  const t = (ox * sy - oy * sx) / cross, u = (ox * dy - oy * dx) / cross;
  return t > 0.001 && t <= 1 && u >= 0 && u <= 1;
}

export function placeCallout(anchor: { x: number; y: number }, bounds: Rect, width: number, height: number,
  obstacles: Rect[], segments: [number, number, number, number][], anchorMarkers: Rect[] = []): Rect | null {
  if (width > bounds.w || height > bounds.h) return null;
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w + 6 && a.x + a.w + 6 > b.x &&
    a.y < b.y + b.h + 6 && a.y + a.h + 6 > b.y;
  const xs = [anchor.x + 30, anchor.x - width - 30, bounds.x, bounds.x + bounds.w - width];
  const ys = [anchor.y - height - 30, anchor.y + 30, bounds.y, bounds.y + bounds.h - height];
  for (let x = bounds.x; x <= bounds.x + bounds.w - width; x += 30) xs.push(x);
  for (let y = bounds.y; y <= bounds.y + bounds.h - height; y += 24) ys.push(y);
  // Индекс экранных звеньев: тысячи вершин GPX не перебираются для каждой
  // возможной позиции. Геометрические проверки остаются точными.
  const cell = 80, grid = new Map<string, number[]>();
  const range = (r: Rect) => ({ x0: Math.floor(Math.max(bounds.x - 10, r.x) / cell),
    x1: Math.floor(Math.min(bounds.x + bounds.w + 10, r.x + r.w) / cell),
    y0: Math.floor(Math.max(bounds.y - 10, r.y) / cell),
    y1: Math.floor(Math.min(bounds.y + bounds.h + 10, r.y + r.h) / cell) });
  const extent = (s: number[], pad = 0): Rect => ({ x: Math.min(s[0], s[2]) - pad,
    y: Math.min(s[1], s[3]) - pad, w: Math.abs(s[2] - s[0]) + 2 * pad, h: Math.abs(s[3] - s[1]) + 2 * pad });
  segments.forEach((s, i) => {
    const r = range(extent(s, 8));
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) {
      const key = `${x}:${y}`, bucket = grid.get(key);
      if (bucket) bucket.push(i); else grid.set(key, [i]);
    }
  });
  const nearby = (r: Rect): number[] => {
    const v = range(r), found = new Set<number>();
    for (let x = v.x0; x <= v.x1; x++) for (let y = v.y0; y <= v.y1; y++)
      for (const i of grid.get(`${x}:${y}`) ?? []) found.add(i);
    return [...found];
  };
  let best: Rect | null = null, score = Infinity;
  for (const x of xs) for (const y of ys) {
    const box = { x, y, w: width, h: height };
    if (x < bounds.x || y < bounds.y || x + width > bounds.x + bounds.w || y + height > bounds.y + bounds.h) continue;
    const d = (x + width / 2 - anchor.x) ** 2 + (y + height / 2 - anchor.y) ** 2;
    if (d >= score) continue; // Уже есть более близкая позиция: тысячи звеньев проверять не нужно.
    if (obstacles.some(o => overlap(box, o)) || nearby(box).some(i => waypointLineIntersects(segments[i], box, 7))) continue;
    const end = { x: Math.max(x, Math.min(x + width, anchor.x)), y: Math.max(y, Math.min(y + height, anchor.y)) };
    const leader: [number, number, number, number] = [anchor.x, anchor.y, end.x, end.y];
    // Линия может выйти из маркера собственного якоря; карточка по-прежнему не перекрывает его.
    if (obstacles.some(o => !(anchorMarkers.includes(o) && anchor.x >= o.x && anchor.x <= o.x + o.w && anchor.y >= o.y && anchor.y <= o.y + o.h)
      && waypointLineIntersects(leader, o, 2)) || nearby(extent(leader, 2)).some(i => crossesLeader(anchor, end, segments[i]))) continue;
    if (d < score) { best = box; score = d; }
  }
  return best;
}

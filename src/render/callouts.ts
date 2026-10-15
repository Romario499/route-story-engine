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
  obstacles: Rect[], segments: [number, number, number, number][], anchorMarkers: Rect[] = [],
  routeMarkers: Rect[] = [], proximity?: { radius: number; avoid: Rect[] }): Rect | null {
  if (width > bounds.w || height > bounds.h) return null;
  const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w + 6 && a.x + a.w + 6 > b.x &&
    a.y < b.y + b.h + 6 && a.y + a.h + 6 > b.y;
  const xs = [anchor.x + 30, anchor.x - width - 30, bounds.x, bounds.x + bounds.w - width];
  const ys = [anchor.y - height - 30, anchor.y + 30, bounds.y, bounds.y + bounds.h - height];
  if (proximity) {
    xs.push(anchor.x - width / 2);
    ys.push(anchor.y - height / 2);
  }
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
  // Площадь закрытых маркеров + длина закрытой линии с защитной полосой 14 px.
  // В отличие от числа пересечений, оценка не зависит от дробления прямого сегмента GPX.
  const coveredLength = (s: number[], box: Rect): number => {
    let lo = 0, hi = 1;
    for (const [a, b, min, max] of [[s[0], s[2], box.x - 7, box.x + box.w + 7],
      [s[1], s[3], box.y - 7, box.y + box.h + 7]]) {
      const delta = b - a;
      if (Math.abs(delta) < 1e-9) { if (a < min || a > max) return 0; continue; }
      const t0 = (min - a) / delta, t1 = (max - a) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      if (lo >= hi) return 0;
    }
    return (hi - lo) * Math.hypot(s[2] - s[0], s[3] - s[1]);
  };
  let best: Rect | null = null, score = Infinity, coverage = Infinity, crossings = Infinity;
  for (const x of new Set(xs)) for (const y of new Set(ys)) {
    const box = { x, y, w: width, h: height };
    if (x < bounds.x || y < bounds.y || x + width > bounds.x + bounds.w || y + height > bounds.y + bounds.h) continue;
    const d = (x + width / 2 - anchor.x) ** 2 + (y + height / 2 - anchor.y) ** 2;
    if (proximity) {
      if (d > proximity.radius ** 2) continue;
      const cx = x + width / 2, cy = y + height / 2;
      // Центр карточки ближе к своему якорю, чем к чужому маркеру или краю его подписи.
      if (proximity.avoid.some(r => d >= (cx - Math.max(r.x, Math.min(r.x + r.w, cx))) ** 2 +
        (cy - Math.max(r.y, Math.min(r.y + r.h, cy))) ** 2)) continue;
    } else if (d >= score) continue; // GPS и journey: прежний ближайший свободный вариант master.
    if (coverage === 0 && crossings === 0 && d >= score) continue;
    if (obstacles.some(o => overlap(box, o))) continue;
    if (!proximity && nearby(box).some(i => waypointLineIntersects(segments[i], box, 7))) continue;
    const covered = routeMarkers.reduce((sum, r) => sum +
      Math.max(0, Math.min(x + width + 6, r.x + r.w) - Math.max(x - 6, r.x)) *
      Math.max(0, Math.min(y + height + 6, r.y + r.h) - Math.max(y - 6, r.y)), 0) +
      nearby(box).reduce((sum, i) => sum + coveredLength(segments[i], box) * 14, 0);
    if (covered > coverage) continue;
    const end = { x: Math.max(x, Math.min(x + width, anchor.x)), y: Math.max(y, Math.min(y + height, anchor.y)) };
    const leader: [number, number, number, number] = [anchor.x, anchor.y, end.x, end.y];
    // Линия может выйти из маркера собственного якоря; карточка по-прежнему не перекрывает его.
    if (obstacles.some(o => !(anchorMarkers.includes(o) && anchor.x >= o.x && anchor.x <= o.x + o.w && anchor.y >= o.y && anchor.y <= o.y + o.h)
      && waypointLineIntersects(leader, o, 2))) continue;
    const crossed = nearby(extent(leader, 2)).filter(i => crossesLeader(anchor, end, segments[i])).length;
    if (!proximity && crossed > 0) continue;
    // Сначала сохраняем маршрут под карточкой; затем — чистую линию выноски и близость к якорю.
    if (covered < coverage || (covered === coverage && (crossed < crossings || (crossed === crossings && d < score)))) {
      best = box; score = d; coverage = covered; crossings = crossed;
    }
  }
  return best;
}

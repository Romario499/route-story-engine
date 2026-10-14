import { latOf, lonOf, mercX, mercY } from '../story/mercator';

/**
 * MapLibre 4.7 pixelMatrix / pixelMatrix3D: x/y are screen numerators, z/w
 * retain OpenGL clip depth. Inputs match coordinatePoint: world pixels + metres.
 * w is camera distance in pixel units (nearZ = viewport height / 50).
 * Do not reject offscreen endpoints: their edge can cross the whole viewport.
 */
export function projectTrackPoint(matrix: ArrayLike<number>, worldX: number, worldY: number,
  elevation: number): { x: number; y: number } | null {
  const component = (row: number) => matrix[row] * worldX + matrix[4 + row] * worldY
    + matrix[8 + row] * elevation + matrix[12 + row];
  const x = component(0), y = component(1), z = component(2), w = component(3);
  if (![x, y, z, w].every(Number.isFinite) || w <= 1e-7 || z < -w) return null;
  const point = { x: x / w, y: y / w };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

/** Пересечение экранного луча с плоскостью высоты якоря, без чтения WebGL depth buffer. */
export function centerForAnchor(inverse: ArrayLike<number>, worldSize: number,
  center: [number, number], anchor: [number, number], target: { x: number; y: number }, elevationDelta: number): [number, number] {
  const ray = (depth: number) => {
    const v = [target.x, target.y, depth, 1];
    const out = Array.from({ length: 4 }, (_, row) => v.reduce((sum, value, col) => sum + inverse[col * 4 + row] * value, 0));
    return out.slice(0, 3).map(value => value / out[3]);
  };
  const a = ray(0), b = ray(1), dz = b[2] - a[2];
  if (Math.abs(dz) < 1e-12) return center;
  const t = (elevationDelta - a[2]) / dz;
  const x = (a[0] + (b[0] - a[0]) * t) / worldSize;
  const y = (a[1] + (b[1] - a[1]) * t) / worldSize;
  return [lonOf(mercX(center[0]) + mercX(anchor[0]) - x), latOf(mercY(center[1]) + mercY(anchor[1]) - y)];
}

// Геометрия на сфере и в проекции Меркатора — без зависимостей.

const R = 6_371_008.8; // средний радиус Земли, м
const RAD = Math.PI / 180;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Web Mercator в долях мира [0..1] — та же плоскость, в которой рисует карта. */
export function mercatorX(lon: number): number {
  return lon / 360 + 0.5;
}
export function mercatorY(lat: number): number {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  const s = Math.sin(clamped * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

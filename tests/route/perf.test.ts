import { describe, expect, it } from 'vitest';
import { buildRoute, parseRouteText } from '../../src/route';

/** Синтетический GPX: n точек раз в 5 с, змейка через ~2000 км, с высотой и временем. */
function syntheticGpx(n: number): string {
  const t0 = Date.UTC(2024, 4, 1, 4, 0, 0);
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="synthetic" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Синтетика</name><trkseg>\n'];
  for (let i = 0; i < n; i++) {
    const lat = (41 + 0.0001 * i * 0.3 + 0.02 * Math.sin(i / 500)).toFixed(6);
    const lon = (39.7 + 0.0001 * i + 0.01 * Math.cos(i / 300)).toFixed(6);
    const ele = (200 + 800 * Math.sin(i / 20000) + 3 * Math.sin(i)).toFixed(1);
    const time = new Date(t0 + i * 5000).toISOString();
    parts.push(`<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele><time>${time}</time></trkpt>\n`);
  }
  parts.push('</trkseg></trk></gpx>\n');
  return parts.join('');
}

describe('производительность', () => {
  it('200 000 точек: parseRouteText + buildRoute < 3 с', () => {
    const text = syntheticGpx(200_000);
    const start = performance.now();
    const parsed = parseRouteText('big.gpx', text);
    if (!parsed.ok) throw new Error(parsed.error);
    const route = buildRoute(parsed.tracks);
    const ms = performance.now() - start;
    if ('error' in route) throw new Error(route.error);
    expect(route.points.length).toBe(200_000);
    expect(route.display.length).toBeLessThanOrEqual(6000);
    expect(route.days).toBeGreaterThanOrEqual(12);
    expect(ms).toBeLessThan(3000);
  });
});

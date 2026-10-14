import { describe, expect, it } from 'vitest';
import { projectTrackPoint } from '../../src/render/projection';

// Column-major pixel matrix: screen x/y, unchanged OpenGL clip z/w.
const constant = (x: number, y: number, z: number, w: number) =>
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, x, y, z, w];

describe('track projection before perspective division', () => {
  it.each([
    ['behind camera with finite mirrored screen coordinates', 40, 60, 0, -2],
    ['zero w', 40, 60, 0, 0],
    ['almost zero w in camera pixel units', 40, 60, 0, 1e-9],
    ['in front of camera but before near plane', 40, 60, -3, 2],
    ['NaN x', NaN, 60, 0, 2], ['infinite y', 40, Infinity, 0, 2],
    ['NaN depth', 40, 60, NaN, 2], ['infinite w', 40, 60, 0, Infinity],
  ])('rejects %s', (_, x, y, z, w) => {
    expect(projectTrackPoint(constant(x as number, y as number, z as number, w as number), 0, 0, 0)).toBeNull();
  });
  it('keeps the near plane itself and does not cull offscreen coordinates', () => {
    expect(projectTrackPoint(constant(-4000, 2000, -2, 2), 0, 0, 0)).toEqual({ x: -2000, y: 1000 });
  });
  it('uses world pixels and elevation in metres, including camera elevation in the matrix', () => {
    const matrix = [2,0,0,0, 0,3,0,0, 0,4,1,0, 10,20,-100,100];
    expect(projectTrackPoint(matrix, 50, 60, 30)).toEqual({ x: 1.1, y: 3.2 });
    expect(projectTrackPoint(matrix, NaN, 60, 30)).toBeNull();
    expect(projectTrackPoint(matrix, 50, 60, Infinity)).toBeNull();
  });
  it.each([
    ['17/30, display 2668→2669', -22.4527315494, -0.6182842384, -19.5649832883, 2.2113639273],
    ['28/60, display 276→277', -22.4725147006, -0.6409750486, -19.7772814318, 2.0007947302],
  ])('rejects both ends across the observed projection pole: %s', (_, za, wa, zb, wb) => {
    // Depths captured by fix-line-probe.mjs from the rendered epic 16:9 frame.
    expect(projectTrackPoint(constant(100, 200, za as number, wa as number), 0, 0, 0)).toBeNull();
    expect(projectTrackPoint(constant(100, 200, zb as number, wb as number), 0, 0, 0)).toBeNull();
  });
});

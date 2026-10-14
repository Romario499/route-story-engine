import { describe, expect, it } from 'vitest';
import { MAP_VIEWPORT } from '../../src/types';
import { fitFrame } from '../../src/ui/studio/frame-fit';

describe('вписывание кадра в область сцены', () => {
  it('9:16 на 1440×900: упирается в высоту области и виден целиком', () => {
    const avail = { width: 1010, height: 572 };
    const f = fitFrame(avail, MAP_VIEWPORT['9:16']);
    expect(f.height).toBe(572);
    expect(f.width).toBe(Math.round(540 * (572 / 960)));
    expect(f.width).toBeLessThanOrEqual(avail.width);
  });

  it('16:9: ограничивает ширина, если область узкая, и высота, если низкая', () => {
    expect(fitFrame({ width: 700, height: 900 }, MAP_VIEWPORT['16:9'])).toMatchObject({ width: 700, height: 394 });
    expect(fitFrame({ width: 1500, height: 400 }, MAP_VIEWPORT['16:9'])).toMatchObject({ width: 711, height: 400 });
  });

  it('больше натурального размера не растягивает', () => {
    expect(fitFrame({ width: 3000, height: 3000 }, MAP_VIEWPORT['9:16'])).toEqual({ scale: 1, width: 540, height: 960 });
  });

  it('нулевая область не даёт отрицательного или нечислового размера', () => {
    expect(fitFrame({ width: 0, height: 0 }, MAP_VIEWPORT['9:16'])).toEqual({ scale: 0, width: 0, height: 0 });
  });
});

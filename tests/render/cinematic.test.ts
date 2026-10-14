import { expect, it } from 'vitest';
import { STYLES } from '../../src/render/styles';

it('диорама: Expedition содержит реальную векторную географию, DEM и высокий наклон; Atlas тоже включает DEM', () => {
  expect(STYLES.epic.pitch).toBeGreaterThanOrEqual(60);
  expect(STYLES.epic.line.color).toBe('#FF6654');
  expect(STYLES.epic.mapStyle.sources.ofm).toMatchObject({ type: 'vector' });
  expect(STYLES.epic.mapStyle.layers.some(l => l.type === 'line' && l.source === 'ofm' && l['source-layer'] === 'transportation')).toBe(true);
  expect(STYLES.atlas.mapStyle.terrain).toMatchObject({ source: 'dem' });
  expect(STYLES.atlas.terrain?.exaggeration).toBeGreaterThan(1);
  expect(STYLES.neon.terrain).toBeUndefined();
});

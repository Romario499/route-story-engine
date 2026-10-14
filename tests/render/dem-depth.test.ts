import { expect, it } from 'vitest';
import { terrainScaleFor, visibleTilesReady } from '../../src/render/scene';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { mapStyleFor } from '../../src/render/styles';

it('вертикальный масштаб зависит от наземного охвата, не наклона', () => {
  expect(terrainScaleFor(8, 0, '16:9')).toBeCloseTo(1);
  expect(terrainScaleFor(10, 0, '16:9')).toBeCloseTo(2.8);
  expect(terrainScaleFor(12, 0, '16:9')).toBeCloseTo(2);
  expect(terrainScaleFor(13.9, 0, '16:9')).toBeCloseTo(1.35);
  expect(terrainScaleFor(10, 60, '16:9')).not.toBe(terrainScaleFor(10, 0, '16:9'));
});

it('ошибка старого покрытия не блокирует загруженные тайлы текущей камеры', () => {
  const map = { areTilesLoaded: () => false, isStyleLoaded: () => true,
    transform: { coveringTiles: () => [{ key: 'current' }] },
    style: { sourceCaches: { dem: { used: true, _updated: true,
      _source: { tileSize: 256, minzoom: 0, maxzoom: 12 },
      _tiles: { current: { state: 'loaded', hasData: () => true },
        old: { state: 'errored', hasData: () => false } } } } } } as unknown as MapLibreMap;
  expect(visibleTilesReady(map)).toBe(true);
});

it('готовность допускает загруженного родителя на один уровень, но не ошибку текущего покрытия', () => {
  const id = { key: 'detail', overscaledZ: 12, scaledTo: () => ({ key: 'parent' }) };
  const tiles: Record<string, { state: string; hasData(): boolean }> = {
    parent: { state: 'loaded', hasData: () => true },
  };
  const map = { isStyleLoaded: () => true, transform: { coveringTiles: () => [id] },
    style: { sourceCaches: { imagery: { used: true, _updated: true,
      _source: { tileSize: 256, minzoom: 0, maxzoom: 18 }, _tiles: tiles,
      getRenderableIds: () => ['parent'] } } } } as unknown as MapLibreMap;
  expect(visibleTilesReady(map)).toBe(true);
  tiles.detail = { state: 'errored', hasData: () => false };
  expect(visibleTilesReady(map)).toBe(false);
  delete tiles.detail;
  tiles.parent.state = 'errored';
  expect(visibleTilesReady(map)).toBe(false);
});

it.each(['epic', 'atlas'] as const)('%s: небо и отмывка используют DEM рельефа, предел DEM 12–13', id => {
  const s = mapStyleFor(id, 2, true);
  expect(s.sky).toBeDefined();
  const shade = s.layers.find(l => l.type === 'hillshade');
  expect(shade).toMatchObject({ source: s.terrain!.source,
    paint: { 'hillshade-illumination-anchor': 'map', 'hillshade-illumination-direction': 315 } });
  expect(s.sources.dem).toMatchObject({ maxzoom: 12 });
});

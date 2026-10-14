// Обход ошибки MapLibre 4.7.1 с рельефом (ADR 0009, п. 6): «Cannot read properties of undefined (reading 'clearFadeHold')».
// Саму ошибку в Node не воспроизвести (нужны WebGL и живые тайлы) — ручная проверка: `node tests/render/terrain-zoom-probe.mjs`.
// Здесь — поведение защиты на подмене кэшей источников и условия, при которых баг проявляется.
import { describe, expect, it } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { guardTerrainTileCache, terrainExaggerationFor } from '../../src/render/scene';
import { STYLES } from '../../src/render/styles';
import { buildRoute } from '../../src/route';
import { buildTimeline } from '../../src/story';
import { FPS } from '../../src/types';
import { enrichmentFor, ok, settings, track } from '../story/fixtures';

const loaded = { hasData: () => true };
const cachedOnly = { hasData: () => true, fromCache: true };

/** Подмена карты: один растровый кэш; тайл 1 лежит в `_tiles`, тайл 2 — только в кэше выпавших тайлов (его и отдаёт оригинал). */
function fakeMap(terrain: boolean) {
  const cache = {
    _tiles: { 1: loaded } as Record<string, { hasData(): boolean }>,
    _getLoadedTile(id: { key: number }) { return id.key === 1 ? loaded : id.key === 2 ? cachedOnly : undefined; },
  };
  const map = { style: { sourceCaches: { imagery: cache } }, terrain: terrain ? {} : null } as unknown as MapLibreMap;
  return { map, cache };
}

describe('guardTerrainTileCache', () => {
  it('с рельефом отдаёт только тайлы из _tiles: тайл из кэша выпавших тайлов не возвращается', () => {
    const { map, cache } = fakeMap(true);
    guardTerrainTileCache(map);
    expect(cache._getLoadedTile({ key: 1 })).toBe(loaded);
    expect(cache._getLoadedTile({ key: 2 })).toBeUndefined();
    expect(cache._getLoadedTile({ key: 3 })).toBeUndefined();
  });

  it('без рельефа поведение MapLibre прежнее: тайл из кэша возвращается', () => {
    const { map, cache } = fakeMap(false);
    guardTerrainTileCache(map);
    expect(cache._getLoadedTile({ key: 2 })).toBe(cachedOnly);
  });

  it('повторный вызов не оборачивает кэш второй раз; карта без стиля не ломает вызов', () => {
    const { map, cache } = fakeMap(true);
    guardTerrainTileCache(map);
    const once = cache._getLoadedTile;
    guardTerrainTileCache(map);
    expect(cache._getLoadedTile).toBe(once);
    expect(() => guardTerrainTileCache({ style: undefined } as unknown as MapLibreMap)).not.toThrow();
  });
});

describe('условия бага реальны', () => {
  it('«Экспедиция»: растровый спутник и рельеф, а зум короткого горного трека бывает > 12,5 при наклоне', () => {
    const style = STYLES.epic.mapStyle;
    expect(style.terrain).toBeDefined();
    expect(style.layers.some((l) => l.type === 'raster')).toBe(true);
    const pts = Array.from({ length: 1500 }, (_, i) => {
      const a = (i / 1499) * Math.PI * 2;
      return { lat: 46.38 + 0.03 * Math.sin(a), lon: 13.84 + 0.04 * Math.cos(a), ele: 1000 + 1800 * Math.sin(a / 2) };
    });
    const route = ok(buildRoute([track('loop.gpx', [pts])]));
    const tl = buildTimeline(route, enrichmentFor(route), settings({ durationSec: 30 }));
    const zooms = Array.from({ length: tl.frameCount }, (_, i) => tl.frameAt(i / FPS)).filter((f) => f.camera.pitch > 0.5).map((f) => f.camera.zoom);
    expect(Math.max(...zooms)).toBeGreaterThan(12.5);
  });
});

describe('terrainExaggerationFor: рельеф не увеличивает общий план', () => {
  it('на общем плане (наклон 0) рельеф плоский: иначе перспектива приближает высокие точки и маршрут выходит из рабочей зоны', () => {
    expect(terrainExaggerationFor(1.8, 0)).toBe(0);
  });

  it('при полном наклоне — полное преувеличение стиля; между ними растёт монотонно; вне 0..1 ограничено', () => {
    expect(terrainExaggerationFor(1.8, 1)).toBeCloseTo(1.8, 12);
    let prev = -1;
    for (let k = 0; k <= 10; k++) {
      const v = terrainExaggerationFor(1.8, k / 10);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
    expect(terrainExaggerationFor(1.8, -0.5)).toBe(0);
    expect(terrainExaggerationFor(1.8, 3)).toBeCloseTo(1.8, 12);
  });
});

it('wide cameras keep the visible tile footprint bounded without flattening close shots', async () => {
  const { cameraForTiles } = await import('../../src/render/scene');
  const cam = { center: [12, 46] as [number, number], zoom: 5, pitch: 1, bearing: 10 };
  expect(cameraForTiles(cam, 'epic', true).pitch * STYLES.epic.pitch).toBeLessThanOrEqual(28);
  expect(cameraForTiles(cam, 'epic', true).zoom).toBeLessThanOrEqual(10);
  expect(cameraForTiles({ ...cam, zoom: 10.5 }, 'epic', true).zoom).toBe(10);
  expect(cameraForTiles(cam, 'epic', false).pitch * STYLES.epic.pitch).toBeLessThanOrEqual(32);
  expect(cameraForTiles({ ...cam, zoom: 13.5 }, 'epic', false).pitch).toBe(1);
});

it('loaded flag alone cannot approve a visible tile with missing data', async () => {
  const { visibleTilesReady } = await import('../../src/render/scene');
  const tile = { state: 'loaded', hasData: () => false };
  const map = { areTilesLoaded: () => true, isStyleLoaded: () => true,
    style: { sourceCaches: { ofm: { used: true, _updated: true, _tiles: { one: tile } } } } } as unknown as MapLibreMap;
  expect(visibleTilesReady(map)).toBe(false);
  tile.hasData = () => true;
  expect(visibleTilesReady(map)).toBe(true);
  tile.state = 'errored';
  expect(visibleTilesReady(map)).toBe(false);
});

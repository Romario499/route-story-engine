// Сцена: MapLibre рисует подложку и рельеф, затем кадр собирается на 2D-холсте (трек, маркеры, оформление).
// Один и тот же рендерер — для живого превью и для покадрового экспорта (таск 06 создаёт свою скрытую сцену).
//
// Системы координат:
//   карта и трек — CSS-пиксели MAP_VIEWPORT (540×960 / 960×540), холст карты = CSS × pixelRatio;
//   оформление (overlay) — дизайн-пиксели (1080×1920 / 1920×1080);
//   scene.canvas = дизайн × (pixelRatio / 2): при pixelRatio 2 это ровно размер файла.
import 'maplibre-gl/dist/maplibre-gl.css';
import { LngLat, Map as MapLibreMap } from 'maplibre-gl';
import { DESIGN_SIZE, MAP_VIEWPORT, type CameraState, type Enrichment, type Format, type FrameState, type Route, type StyleId, type StorySettings } from '../types';
import { ensureFonts } from './fonts';
import { drawOverlay } from './overlay';
import { mapStyleFor, STYLES, type StyleDef } from './styles';
import { drawTrackLayer, prepareTrack, type TrackModel } from './track';
import { applyTiltShift, drawCinematicGeography } from './cinematic';
import { layoutFor } from './layout';
import { centerForAnchor, projectTrackPoint } from './projection';

export interface Scene {
  readonly canvas: HTMLCanvasElement;          // кадр в дизайн-размере × (pixelRatio/2)
  setStyle(id: StyleId): Promise<void>;
  /** reconstruction — маршрут восстановлен по афише, а не записан GPS: оформление помечает расчётные показатели («расчётно»). */
  setData(route: Route, enrichment: Enrichment, settings: StorySettings, reconstruction: boolean): void;
  render(frame: FrameState, opts: { waitForTiles: boolean; timeoutMs?: number }): Promise<{ tilesComplete: boolean }>;
  /** Прогрев короткого окна той же карты без сборки/кодирования кадров. */
  warmup?(frames: readonly FrameState[], opts: { timeoutMs: number }): Promise<void>;
  destroy(): void;
}

const DEFAULT_TILE_TIMEOUT_MS = 10_000;
const STYLE_LOAD_TIMEOUT_MS = 15_000;

// ───────────────────────── шрифты ─────────────────────────
// Загрузка — в fonts.ts (строгая: при отказе FontLoadError); здесь реэкспорт, чтобы старые импорты работали.

export { ensureFonts };

// ───────────────────────── общий тон кадра ─────────────────────────

let grainTile: HTMLCanvasElement | null = null;
function getGrainTile(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d')!;
  const img = g.createImageData(160, 160);
  let seed = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const v = 90 + (seed >>> 24) * 0.45;
    img.data[i] = v; img.data[i + 1] = v * 0.93; img.data[i + 2] = v * 0.8; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

/**
 * Общий тон кадра по профилю стиля (`StyleDef.tone`): шаги цвета → зерно → дымка у горизонта → виньетка.
 * pitchShare — наклон камеры кадра 0..1 (`frame.camera.pitch`). У «Атласа» ничего не делает.
 */
export function applyTone(ctx: CanvasRenderingContext2D, style: StyleDef, w: number, h: number, pitchShare = 1, nativeSky = false): void {
  const { tone } = style;
  for (const tint of tone.tints) {
    ctx.save();
    ctx.globalCompositeOperation = tint.blend;
    ctx.globalAlpha = tint.alpha;
    ctx.fillStyle = tint.color;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (tone.grain > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.16 * tone.grain;
    const pattern = ctx.createPattern(getGrainTile(), 'repeat');
    if (pattern) { ctx.fillStyle = pattern; ctx.fillRect(0, 0, w, h); }
    ctx.restore();
  }
  // дымка у горизонта: сверху кадра, сила — по наклону камеры (на общем плане с pitch 0 её нет)
  const hazeK = tone.haze ? tone.haze.strength * Math.max(0, Math.min(1, pitchShare)) : 0;
  if (!nativeSky && tone.haze && hazeK > 0) {
    const g = ctx.createLinearGradient(0, 0, 0, h * tone.haze.height);
    g.addColorStop(0, `rgba(${tone.haze.rgb},${hazeK.toFixed(3)})`);
    g.addColorStop(0.55, `rgba(${tone.haze.rgb},${(hazeK * 0.38).toFixed(3)})`);
    g.addColorStop(1, `rgba(${tone.haze.rgb},0)`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h * tone.haze.height);
    ctx.restore();
  }
  if (tone.vignette.strength > 0) {
    const r = Math.hypot(w, h) / 2;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, r);
    const { rgb, strength } = tone.vignette;
    g.addColorStop(0, `rgba(${rgb},0)`);
    g.addColorStop(1, `rgba(${rgb},${(strength * 0.75).toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}

// ───────────────────────── обход ошибки MapLibre 4.7.1 с рельефом ─────────────────────────

interface TileLike { hasData(): boolean }
interface SourceCacheLike {
  _tiles?: Record<string, TileLike>;
  _getLoadedTile?: (tileID: { key: string | number }) => TileLike | undefined;
  __rsGuarded?: boolean;
}

/**
 * С включённым `terrain` растровая подложка берёт тайл-родитель недогруженного тайла через `SourceCache._getLoadedTile`,
 * а тот умеет вернуть тайл из кэша выпавших тайлов, которого нет в `_tiles`; `update()` кладёт его в retain и падает:
 * «Cannot read properties of undefined (reading 'clearFadeHold')» (сильный зум, горный трек ~17 км; ADR 0009, п. 6).
 * Пока рельеф включён, отдаём только тайлы из `_tiles`. Кэш не отключаем: без него каждый кадр заново грузит тайлы.
 * Лезем в приватное `map.style.sourceCaches` — как и `hasErroredTiles`; при обновлении `maplibre-gl` проверить первым.
 */
export function guardTerrainTileCache(map: MapLibreMap): void {
  const caches = (map.style as unknown as { sourceCaches?: Record<string, SourceCacheLike> } | undefined)?.sourceCaches;
  if (!caches) return;
  for (const sc of Object.values(caches)) {
    const original = sc._getLoadedTile;
    if (sc.__rsGuarded || typeof original !== 'function') continue;
    sc.__rsGuarded = true;
    sc._getLoadedTile = (tileID) => {
      const tile = sc._tiles?.[String(tileID.key)];
      if (tile && tile.hasData()) return tile;
      return map.terrain ? undefined : original.call(sc, tileID);
    };
  }
}

// ───────────────────────── рельеф и общий план ─────────────────────────

/**
 * Legacy-адаптер T25. Живая сцена использует terrainScaleFor, включая общий
 * план: наклон больше не меняет форму DEM.
 */
export function terrainExaggerationFor(base: number, pitchShare: number): number {
  return base * Math.max(0, Math.min(1, pitchShare));
}

/** DEM-масштаб по наземному охвату. Pitch намеренно отсутствует в интерфейсе. */
export function terrainScaleFor(zoom: number, latitude: number, format: Format): number {
  const z = zoom - Math.log2(Math.max(0.15, Math.cos(latitude * Math.PI / 180)))
    - Math.log2(MAP_VIEWPORT[format].width / 960);
  const knots = [[8, 1], [10, 2.8], [12, 2], [13.9, 1.35]];
  if (z <= 8) return 1;
  for (let i = 1; i < knots.length; i++) {
    if (z <= knots[i][0]) {
      const [az, ae] = knots[i - 1], [bz, be] = knots[i];
      const u = (z - az) / (bz - az), e = u * u * (3 - 2 * u);
      return ae + (be - ae) * e;
    }
  }
  return 1.35;
}

// ───────────────────────── сцена ─────────────────────────

/** Bound the visible tile footprint on wide shots while preserving close terrain shots. */
export function cameraForTiles(camera: CameraState, styleId: StyleId, waypoints: boolean): CameraState {
  const stylePitch = STYLES[styleId].pitch;
  const zoom = waypoints ? Math.min(10, camera.zoom) : camera.zoom;
  const blend = Math.max(0, Math.min(1, (zoom - 6) / 3));
  const physicalMax = camera.pitchDegrees === undefined ? stylePitch : 74;
  const maxPitch = waypoints ? 28 : 32 + (physicalMax - 32) * blend * blend * (3 - 2 * blend);
  return { ...camera, zoom, pitch: Math.min(camera.pitch, maxPitch / Math.max(1, stylePitch)),
    ...(camera.pitchDegrees === undefined ? {} : { pitchDegrees: Math.min(camera.pitchDegrees, maxPitch) }) };
}

/** MapLibre treats errored tiles as loaded; active tiles must also contain data. ADR 0009 stays enabled. */
export function visibleTilesReady(map: MapLibreMap): boolean {
  const style = map.style as unknown as { _loaded?: boolean; sourceCaches?: Record<string, {
    used?: boolean; usedForTerrain?: boolean; _updated?: boolean;
    _sourceLoaded?: boolean; _sourceErrored?: boolean; tileSize?: number;
    _source?: { tileSize: number; minzoom: number; maxzoom: number; roundZoom?: boolean; reparseOverscaled?: boolean;
      hasTile?: (id: { key: string | number }) => boolean };
    _tiles?: Record<string, { state?: string; hasData(): boolean }>;
    getRenderableIds?: () => string[];
  }> } | undefined;
  if (!style || !(style._loaded ?? map.isStyleLoaded())) return false;
  const caches = style.sourceCaches;
  if (!caches) return false;
  return Object.values(caches).every(sc => {
    if (!sc.used && !sc.usedForTerrain) return true;
    if (!sc._updated || sc._sourceLoaded === false || sc._sourceErrored) return false;
    const source = sc._source;
    const terrainCache = map.terrain?.sourceCache;
    // DEM-покрытие должно совпадать с сеткой, которую только что нарисовал
    // TerrainSourceCache. Повторный coveringTiles(1024) при смешанном LOD
    // выбирает соседнюю пирамиду и может бесконечно ждать ненужный тайл.
    const ids = sc.usedForTerrain && terrainCache ? terrainCache.getRenderableTiles().map(tile =>
      tile.tileID.scaledTo(Math.max(source!.minzoom, Math.min(source!.maxzoom,
        tile.tileID.overscaledZ - terrainCache.deltaZoom)))) : source && map.transform ? map.transform.coveringTiles({
      tileSize: sc.usedForTerrain ? sc.tileSize! : source.tileSize, minzoom: source.minzoom, maxzoom: source.maxzoom,
      roundZoom: sc.usedForTerrain ? false : source.roundZoom, reparseOverscaled: source.reparseOverscaled,
      terrain: map.terrain,
    }).filter(id => !source.hasTile || source.hasTile(id)) : null;
    const ready = (tile: { state?: string; hasData(): boolean } | undefined) =>
      !!tile && tile.state !== 'errored' && tile.hasData();
    if (!ids) return Object.values(sc._tiles ?? {}).every(ready);
    const renderable = sc.getRenderableIds ? new Set(sc.getRenderableIds()) : null;
    return ids.every(id => {
      const tile = sc._tiles?.[id.key];
      if (tile?.state === 'errored') return false;
      if (ready(tile)) return true;
      // Фиксированный профиль качества: только один заранее разрешённый уровень
      // родителя, удерживаемый этой картой. Выпавший GPU-кэш не подходит (ADR 0009).
      const z = id.overscaledZ - 1;
      if (z < source!.minzoom || typeof id.scaledTo !== 'function') return false;
      const parent = id.scaledTo(z);
      return ready(sc._tiles?.[parent.key]) &&
        (sc.usedForTerrain || !renderable || renderable.has(parent.key));
    });
  });
}

export async function createScene(
  host: HTMLElement,
  opts: { format: Format; styleId: StyleId; pixelRatio: number },
): Promise<Scene> {
  const { format, pixelRatio } = opts;
  let styleId = opts.styleId;
  const vp = MAP_VIEWPORT[format];
  const design = DESIGN_SIZE[format];

  host.style.position = 'relative';
  host.style.width = `${vp.width}px`;
  host.style.height = `${vp.height}px`;
  host.style.overflow = 'hidden';

  // Контейнер карты — настоящего размера и всегда в раскладке: лежит в body за экраном, а не внутри host.
  // MapLibre берёт размер из clientWidth/clientHeight (нет раскладки → 400×300), а host может быть
  // отсоединён от документа или скрыт (display:none) — так делает скрытая сцена экспорта.
  const mapEl = document.createElement('div');
  mapEl.style.cssText = `position:fixed;left:-100000px;top:0;width:${vp.width}px;height:${vp.height}px;visibility:hidden;pointer-events:none;`;
  document.body.append(mapEl);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round((design.width * pixelRatio) / 2);
  canvas.height = Math.round((design.height * pixelRatio) / 2);
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${vp.width}px;height:${vp.height}px;display:block;`;
  host.append(canvas);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const focusBuffer = document.createElement('canvas');

  const map = new MapLibreMap({
    container: mapEl,
    style: mapStyleFor(styleId, pixelRatio, true),
    center: [0, 20],
    zoom: 2,
    interactive: false,
    attributionControl: false,
    preserveDrawingBuffer: true,
    antialias: true,
    fadeDuration: 0,
    pixelRatio,
    maxPitch: 85,
    trackResize: false,
    renderWorldCopies: false,
    // Три источника Expedition: 126 сохранённых тайлов суммарно, помимо покрытия.
    maxTileCacheSize: 42,
  });

  // кэши источников создаются на каждый стиль заново — защита ставится после загрузки каждого
  map.on('style.load', () => guardTerrainTileCache(map));

  // 'load' приходит, когда стиль и первые тайлы готовы; при плохой сети не ждём дольше STYLE_LOAD_TIMEOUT_MS
  await Promise.all([
    new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); map.off('load', finish); resolve(); };
      const timer = setTimeout(finish, STYLE_LOAD_TIMEOUT_MS);
      map.on('load', finish);
    }),
    ensureFonts(),
  ]);

  guardTerrainTileCache(map);

  function alignTerrainLod(): void {
    if (!map.terrain) return;
    const tc = map.terrain.sourceCache;
    const sc = tc.sourceCache, update = sc.update;
    const recent = new Map<string, { id: ReturnType<typeof map.transform.coveringTiles>[number]; until: number }>();
    // DEM выбирается из сетки mesh, а не независимым повторным LOD-расчётом.
    // Сохраняем штатные deltaZoom, удержание родителей и защиту ADR 0009.
    sc.update = (transform, terrain) => {
      const covering = transform.coveringTiles;
      transform.coveringTiles = (options) => {
        if (options.tileSize !== sc.tileSize) return covering.call(transform, options);
        const mesh = covering.call(transform, { tileSize: tc.tileSize, minzoom: tc.minzoom,
          maxzoom: tc.maxzoom, reparseOverscaled: false, terrain });
        const now = performance.now();
        for (const [key, value] of recent) if (value.until < now) recent.delete(key);
        for (const id of mesh) {
          const dem = id.scaledTo(Math.max(sc._source.minzoom, Math.min(sc._source.maxzoom, id.overscaledZ - tc.deltaZoom)));
          recent.set(dem.key, { id: dem, until: now + 1000 });
        }
        return [...recent.values()].map(v => v.id);
      };
      try { update.call(sc, transform, terrain); }
      finally { transform.coveringTiles = covering; }
    };
  }
  alignTerrainLod();

  // размер холста карты обязан быть MAP_VIEWPORT × pixelRatio — иначе кадр молча исказится
  const expectW = Math.round(vp.width * pixelRatio), expectH = Math.round(vp.height * pixelRatio);
  if (map.getCanvas().width !== expectW || map.getCanvas().height !== expectH) map.resize();
  if (map.getCanvas().width !== expectW || map.getCanvas().height !== expectH) {
    const got = `${map.getCanvas().width}×${map.getCanvas().height}`;
    map.remove(); mapEl.remove(); canvas.remove();
    throw new Error(`Карта получила размер ${got} вместо ${expectW}×${expectH}`);
  }

  let route: Route | null = null;
  let enrichment: Enrichment | null = null;
  let settings: StorySettings | null = null;
  let reconstruction = false;
  let model: TrackModel | null = null;
  let lastFrame: FrameState | null = null;
  let destroyed = false;
  let rendering = false;
  let renderRevision = 0;
  let composedThisTick = false;

  const nextMapEvent = (ms: number) => new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer); map.off('data', finish); map.off('render', finish); map.off('error', finish); resolve();
    };
    const timer = setTimeout(finish, ms);
    map.on('data', finish); map.on('render', finish); map.on('error', finish);
  });

  function placeCamera(frame: FrameState): void {
    const cam = frame.camera;
    // Прямая запись сохраняет обход ADR 0009; setTerrain на каждом кадре разрушал бы кэш.
    const baseExaggeration = STYLES[styleId].terrain?.exaggeration;
    const terrain = map.terrain as unknown as { exaggeration: number } | null | undefined;
    if (terrain && baseExaggeration !== undefined) terrain.exaggeration = terrainScaleFor(cam.zoom, cam.center[1], format);
    map.jumpTo({
      center: cam.center,
      zoom: cam.zoom,
      pitch: cam.pitchDegrees ?? cam.pitch * STYLES[styleId].pitch,
      bearing: cam.bearing,
    });
    if (map.terrain) {
      map.transform.elevation = map.terrain.getElevationForLngLatZoom(map.transform.center, map.transform.tileZoom);
      map.transform.minElevationForCurrentTile = map.terrain.getMinTileElevationForLngLatZoom(map.transform.center, map.transform.tileZoom);
    }
    correctAnchor(frame);
  }

  function correctAnchor(frame: FrameState): boolean {
    let moved = false;
    if (frame.shot && route?.source?.kind !== 'waypoints' && frame.act === 'journey') {
      // Поправка в настоящей перспективной проекции, включая DEM; отдельная композиция портрета.
      const work = layoutFor(format, styleId).work;
      const target = { x: (work.x + work.w * (format === '9:16' ? 0.5 : 0.42)) / 2,
        y: (work.y + work.h * (format === '9:16' ? 0.625 : 0.56)) / 2 };
      for (let i = 0; i < 8; i++) {
        const head = map.project(frame.headLonLat);
        if (Math.hypot(head.x - target.x, head.y - target.y) < 2) break;
        moved = true;
        // Точный экранный луч на высоте DEM-якоря; map.unproject читает GPU depth
        // buffer и синхронизирует весь конвейер на каждом кадре.
        const c = map.getCenter(), tr = map.transform;
        const elevation = map.queryTerrainElevation({ lng: frame.headLonLat[0], lat: frame.headLonLat[1] }) ?? 0;
        const center = centerForAnchor(tr.pixelMatrixInverse, tr.worldSize, [c.lng, c.lat],
          frame.headLonLat, target, elevation);
        // На крутом склоне новая высота центра меняет перспективу: полушаг
        // гасит колебания обратной проекции, не читая GPU и не перерисовывая карту.
        map.jumpTo({ center: [(c.lng + center[0]) / 2, (c.lat + center[1]) / 2] });
        if (map.terrain) {
          map.transform.elevation = map.terrain.getElevationForLngLatZoom(map.transform.center, map.transform.tileZoom);
          map.transform.minElevationForCurrentTile = map.terrain.getMinTileElevationForLngLatZoom(map.transform.center, map.transform.tileZoom);
        }
      }
    }
    return moved;
  }

  function compose(frame: FrameState): void {
    const style = STYLES[styleId];
    const w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(map.getCanvas(), 0, 0, w, h);
    applyTone(ctx, style, w, h, frame.camera.pitch, true);
    if (frame.shot) {
      // Свет меняется плавно по плану сцены; это художественная экспозиция, не время суток.
      ctx.save(); ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = 0.12 * frame.shot.light;
      ctx.fillStyle = style.id === 'neon' ? '#84BADB' : '#FFD49C'; ctx.fillRect(0, 0, w, h); ctx.restore();
      applyTiltShift(ctx, focusBuffer, frame.camera.pitch, frame.shot.focus);
    }
    if (route && model) {
      // Same units, terrain elevation and longitude handling as locationPoint /
      // coordinatePoint in MapLibre 4.7.1; only the track checks clip depth.
      const tr = map.transform, terrain = map.terrain;
      const matrix = terrain ? tr.pixelMatrix3D : tr.pixelMatrix;
      // трек и маркеры — в CSS-пикселях карты
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      drawTrackLayer({
        ctx, model, route, enrichment, lang: settings?.lang ?? 'ru', frame, style, view: vp,
        endpointLabels: !frame.shot || route.source?.kind === 'waypoints',
        project: (lon, lat) => map.project([lon, lat]),
        projectTrack: (lon, lat) => {
          const ll = new LngLat(lon, lat), c = tr.locationCoordinate(ll);
          const elevation = terrain ? terrain.getElevationForLngLatZoom(ll, tr.tileZoom) : 0;
          return projectTrackPoint(matrix, c.x * tr.worldSize, c.y * tr.worldSize, elevation);
        },
      });
      // оформление — в дизайн-пикселях
      if (settings) {
        ctx.setTransform(pixelRatio / 2, 0, 0, pixelRatio / 2, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if (enrichment) {
          const dem = !!map.terrain && visibleTilesReady(map) &&
            map.queryTerrainElevation({ lng: frame.headLonLat[0], lat: frame.headLonLat[1] }) !== null;
          drawCinematicGeography(ctx, frame, route, enrichment, settings, style,
            (lon, lat) => map.project([lon, lat]), model, dem, reconstruction,
            map.terrain?.exaggeration ?? 1);
        }
        drawOverlay(ctx, frame, { route, enrichment, settings, style, reconstruction });
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    lastFrame = frame;
    composedThisTick = true;
    requestAnimationFrame(() => { composedThisTick = false; });
  }

  /** Ждём тайлы кадра (в том числе рельеф); true — всё загружено. */
  async function settle(_frame: FrameState, timeoutMs: number, current: () => boolean = () => true): Promise<boolean> {
    const t0 = performance.now();
    for (;;) {
      if (destroyed || !current()) return false;
      map.redraw();
      // redraw синхронный: загруженные до прохода тайлы уже подготовлены и нарисованы.
      if (visibleTilesReady(map)) return true;
      if (performance.now() - t0 > timeoutMs) {
        return false;
      }
      // DEM меняет охват в текущем проходе; обновляем выбор, сохраняя
      // уже начатые запросы короткого окна, без повторного compose.
      map.style._updateSources(map.transform);
      await nextMapEvent(Math.min(40, Math.max(1, timeoutMs - (performance.now() - t0))));
    }
  }

  // тайлы пришли, пока кадр стоит (пауза): перерисовать последний кадр без пересчёта камеры
  const refreshLastFrame = () => {
    if (destroyed || rendering || composedThisTick || !lastFrame) return;
    composedThisTick = true;
    requestAnimationFrame(() => {
      composedThisTick = false;
      if (!destroyed && !rendering && lastFrame && visibleTilesReady(map)) {
        if (correctAnchor(lastFrame)) map.redraw();
        if (visibleTilesReady(map)) compose(lastFrame);
      }
    });
  };
  map.on('render', refreshLastFrame);
  map.on('data', refreshLastFrame);

  const scene: Scene = {
    canvas,

    async warmup(frames, o) {
      rendering = true;
      const started = performance.now();
      try {
        for (const f of frames) {
          if (destroyed || performance.now() - started >= o.timeoutMs) break;
          placeCamera({ ...f, camera: cameraForTiles(f.camera, styleId, route?.source?.kind === 'waypoints') });
          if (!visibleTilesReady(map)) await settle(f, Math.max(1, o.timeoutMs - (performance.now() - started)));
        }
      } finally { rendering = false; }
    },

    async setStyle(id) {
      if (destroyed || id === styleId) return;
      styleId = id;
      const loaded = new Promise<void>((resolve) => map.once('style.load', () => resolve()));
      map.setStyle(mapStyleFor(id, pixelRatio, true), { diff: false });
      await loaded;
      alignTerrainLod();
      if (lastFrame && !destroyed) {
        placeCamera(lastFrame);
        map.redraw();
        if (visibleTilesReady(map)) compose(lastFrame);
      }
    },

    setData(r, e, s, isReconstruction) {
      if (r !== route) model = prepareTrack(r);
      route = r; enrichment = e; settings = s; reconstruction = isReconstruction;
      if (lastFrame && !destroyed && !rendering && visibleTilesReady(map)) compose(lastFrame);
    },

    async render(frame, o) {
      if (destroyed) return { tilesComplete: false };
      frame = { ...frame, camera: cameraForTiles(frame.camera, styleId, route?.source?.kind === 'waypoints') };
      const revision = ++renderRevision;
      rendering = true;
      try {
        placeCamera(frame);
        if (!o.waitForTiles) {
          lastFrame = frame;
          const current = () => revision === renderRevision;
          let ready = await settle(frame, DEFAULT_TILE_TIMEOUT_MS, current);
          if (!current()) return { tilesComplete: false };
          if (ready && correctAnchor(frame)) ready = await settle(frame, DEFAULT_TILE_TIMEOUT_MS, current);
          if (ready) compose(frame);
          return { tilesComplete: ready };
        }
        const started = performance.now(), budget = o.timeoutMs ?? DEFAULT_TILE_TIMEOUT_MS;
        let done = await settle(frame, budget);
        // DEM мог прийти после размещения камеры: исправляем только фактическое
        // отклонение якоря, затем подтверждаем новое покрытие в том же бюджете.
        if (done && correctAnchor(frame)) done = await settle(frame, Math.max(1, budget - (performance.now() - started)));
        if (done) compose(frame);
        return { tilesComplete: done };
      } finally {
        rendering = false;
      }
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { map.remove(); } catch { /* уже освобождено */ }
      canvas.remove();
      mapEl.remove();
    },
  };
  return scene;
}

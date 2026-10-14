// Три визуальных стиля ролика. Подложки — только открытые тайлы без ключей (R34i):
//   Esri World Imagery (спутник, только «Экспедиция»), AWS Terrain Tiles / terrarium (рельеф «Экспедиции», отмывка «Атласа»),
//   OpenFreeMap (векторные тайлы OpenStreetMap, без ключа и без подписей) — на них «Атлас» и «Неон» рисуют свою карту.
//   ОТКЛОНЕНИЕ ОТ СПЕЦИФИКАЦИИ: растровые CARTO dark/light_nolabels больше не отдаются без ключа — на каждом
//   тайле водяной знак «API KEY REQUIRED» (проверено 2026-10-09), поэтому вместо них — OpenFreeMap.
//   Подписей на карте нет: названия рисуем сами — поэтому надписи переключаются RU/EN.
//
// Профиль стиля — данные: карта, палитра, шрифтовые роли, линия, маркер, движение, общий тон кадра.
// Их читают track.ts (линия, маркеры), scene.ts (тон), overlay.ts (палитра, шрифты) и UI (миниатюра, названия).
import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';
import type { ChapterMood, ChapterMoodState, InfoKey, StyleId } from '../types';
import { FONT_FAMILIES } from './fonts';

/** Шаг общего тона кадра: заливка цветом с режимом наложения поверх подложки, до трека. */
export interface ToneTint { color: string; blend: GlobalCompositeOperation; alpha: number }

/** Общий тон сцены — задаётся стилем; у «Атласа» выключен целиком (нет шагов, виньетки и зерна). */
export interface ToneDef {
  tints: ToneTint[];
  /** Виньетка: сила 0..1 и цвет `r,g,b`. */
  vignette: { strength: number; rgb: string };
  /** Зерно 0..1 (детерминированная плитка, без движения). */
  grain: number;
  /**
   * Дымка у горизонта: градиент сверху кадра высотой `height` (доля высоты) цвета `rgb` силой `strength` 0..1.
   * Растёт вместе с наклоном камеры (на общем плане с pitch 0 её нет). Это холст сцены: небо MapLibre 4.7.1 (`sky`)
   * при наклоне до 45° не рисует ни небо, ни туман (туман — только с pitch ≥ 60°), см. ADR 0009.
   */
  haze?: { rgb: string; height: number; strength: number };
}

/** Роль шрифта. Размеры — дизайн-пиксели Full HD (9:16 — 1080×1920, 16:9 — 1920×1080); tracking — доля em. */
export interface TypeRole { family: string; weight: number; size: number }
export interface TitleRole { family: string; weight: number; min: number; max: number; tracking: number }
export interface KickerRole extends TypeRole { tracking: number }

export interface StyleDef {
  id: StyleId; nameRu: string; nameEn: string; descriptionRu: string;
  mapStyle: StyleSpecification;
  terrain?: { exaggeration: number };
  /** Максимальный наклон камеры, градусы (CameraState.pitch — доля от него). */
  pitch: number;
  palette: {
    line: string; lineGlow: string; ghost: string; transfer: string; text: string; cardBg: string; accent: string;
    /** Вторичный текст и тихие элементы. */
    secondary: string;
  };
  /** Роли шрифтов ролика (история 65). */
  type: {
    title: TitleRole;
    number: TypeRole;
    label: TypeRole;
    secondary: TypeRole;
    kicker: KickerRole; // короткий служебный надзаголовок, caps
  };
  /** CSS-стеки для старых потребителей (`overlay.ts`): собраны из `type`. */
  fonts: { title: string; numbers: string; label: string };
  /** Линия маршрута. width — дизайн-пиксели (на карте это половина: MAP_VIEWPORT). */
  line: {
    width: number;
    /** Основной цвет и «сердцевина» (если совпадает с основным — сердцевина не рисуется). */
    color: string; core: string;
    /** Сила свечения 0..1; 0 — без свечения. Свечение одно, не пачка контуров. */
    glow: number; glowColor: string; glowBlend: GlobalCompositeOperation;
    /** Непройденный остаток («след») и его тонкая тёмная подложка — чтобы след читался на снегу и песке. */
    ghost: string; ghostCasing: string;
    /** Переезд — пунктир этого цвета; dash — длина штриха и промежутка в долях толщины. */
    gap: string; dash: [number, number];
    /** Окантовка под линией — отделяет её от пёстрой подложки. */
    casing: { color: string; scale: number };
  };
  /** Маркер: «голова» маршрута; старт — кольцо, финиш — флаг (цвета линии). Размеры — дизайн-пиксели. */
  marker: {
    fill: string; ring: string; radius: number; ringWidth: number; ringGap: number;
    /** Мягкое свечение вокруг головы 0..1 (0 — нет). */
    glow: number;
    /** Скругление подписи у старта и финиша (CSS-пиксели карты). */
    labelRadius: number;
  };
  /** Появление текста: fade, либо fade со сдвигом `rise` дизайн-пикселей снизу вверх за `appearSec`. */
  motion: { appear: 'fade-rise' | 'fade'; rise: number; appearSec: number };
  /** Состав показателей по умолчанию: 2 главных + страна (история 120). */
  defaultInfo: Partial<Record<InfoKey, boolean>>;
  /** Общий тон сцены. */
  tone: ToneDef;
  attribution: string;
  /** Фон карточки выбора стиля (запасной вариант, пока нет миниатюры). */
  swatchCss: string;
  /** Миниатюра стиля; файл снимает scripts/make-style-thumbs.mjs (таск 15). */
  thumb: string;
}

const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const OPENFREEMAP = 'https://tiles.openfreemap.org/planet';
// Тексты атрибуции — точные формулировки источников (ADR 0008); имена провайдеров — латиницей в RU и EN.
const OFM_ATTRIBUTION = 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap';
const AWS_ATTRIBUTION = 'Terrain Tiles on AWS (SRTM, USGS, NOAA)';
const ESRI_IMAGERY_ATTRIBUTION = 'Esri, Vantor, Earthstar Geographics, GIS User Community';

type Expr = unknown[];

const cls = (...names: string[]): FilterSpecification => ['in', ['get', 'class'], ['literal', names]] as never;
/** Толщина дороги растёт со зумом; base — относительная «важность». */
const roadWidth = (base: number): Expr =>
  ['interpolate', ['exponential', 1.5], ['zoom'], 5, base * 0.25, 10, base * 0.8, 14, base * 2.2, 18, base * 6];
const borders = (level: 'country' | 'region'): FilterSpecification => (level === 'country'
  ? ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]]
  : ['all', ['>=', ['get', 'admin_level'], 3], ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]]) as never;
const countryBorderWidth = (min: number, max: number): Expr => ['interpolate', ['linear'], ['zoom'], 2, min, 10, max];

// ───────────────────────── шрифты ─────────────────────────

const FALLBACK = {
  [FONT_FAMILIES.manrope]: "system-ui, 'Segoe UI', sans-serif",
  [FONT_FAMILIES.serif]: "Georgia, 'Times New Roman', serif",
  [FONT_FAMILIES.mono]: "Consolas, 'Courier New', monospace",
} as const;

/** CSS-стек по имени из FONT_FAMILIES: имя в кавычках + запасные (на случай, если шрифт не загрузился — экспорт это блокирует). */
export function fontStack(family: string): string {
  const fallback = (FALLBACK as Record<string, string>)[family] ?? 'sans-serif';
  return `'${family}', ${fallback}`;
}

const MANROPE = FONT_FAMILIES.manrope;
const SERIF = FONT_FAMILIES.serif;
const MONO = FONT_FAMILIES.mono;

/** Все ключи InfoKey заданы явно: включены только перечисленные. */
function info(...on: InfoKey[]): Partial<Record<InfoKey, boolean>> {
  const keys: InfoKey[] = ['distance', 'day', 'date', 'country', 'city', 'altitude', 'speed', 'profile', 'progress'];
  return Object.fromEntries(keys.map((k) => [k, on.includes(k)]));
}

// ───────────────────────── миниатюра-заглушка ─────────────────────────

/** Мини-сцена для карточки выбора стиля: фон + кривая «трек» (SVG в data-URI). */
function swatch(background: string, line: string, glow: string | null, width = 5): string {
  const path = 'M-6 150 C 40 140, 50 96, 92 100 S 150 56, 206 28';
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 140' preserveAspectRatio='none'>`
    + (glow ? `<path d='${path}' transform='scale(0.97 0.9)' fill='none' stroke='${glow}' stroke-width='${width * 2.4}' stroke-linecap='round' opacity='0.28'/>` : '')
    + `<path d='${path}' transform='scale(0.97 0.9)' fill='none' stroke='${line}' stroke-width='${width}' stroke-linecap='round'/>`
    + `<circle cx='200' cy='25' r='${width * 1.3}' fill='#fff' stroke='${line}' stroke-width='2'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, '%23')}") center/cover no-repeat, ${background}`;
}

// ───────────────────────── векторные подложки «Атласа» и «Неона» ─────────────────────────

interface VectorTheme {
  /** Лист/фон под всем. */
  sheet: string;
  land: string; landClasses: string[]; landuse: string; park: string; building: string;
  water: string; waterEdge: string; waterway: string;
  roadMinor: string; roadMajor: string; roadMinorW: number; roadMajorW: number;
  borderCountry: { color: string; opacity: number; width: [number, number]; dash?: [number, number] };
  borderRegion: { color: string; opacity: number };
}

/** Слои OpenFreeMap одной палитры. `extra` вставляется над сушей и под водой (отмывка). */
function vectorLayers(t: VectorTheme, extra: StyleSpecification['layers'] = []): StyleSpecification['layers'] {
  return [
    { id: 'bg', type: 'background', paint: { 'background-color': t.sheet } },
    { id: 'landcover', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: cls(...t.landClasses), paint: { 'fill-color': t.land } },
    { id: 'landuse', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: cls('residential', 'commercial', 'industrial', 'retail'), paint: { 'fill-color': t.landuse } },
    { id: 'park', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': t.park } },
    ...extra,
    { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': t.water } },
    { id: 'water-edge', type: 'line', source: 'ofm', 'source-layer': 'water', paint: { 'line-color': t.waterEdge, 'line-width': 0.6 } },
    { id: 'waterway', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': t.waterway, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 14, 1.6] } },
    { id: 'building', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': t.building } },
    { id: 'road-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 9, filter: cls('minor', 'service', 'track', 'path'), paint: { 'line-color': t.roadMinor, 'line-width': roadWidth(t.roadMinorW) as never } },
    { id: 'road-major', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 5, filter: cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary'), paint: { 'line-color': t.roadMajor, 'line-width': roadWidth(t.roadMajorW) as never } },
    { id: 'border-region', type: 'line', source: 'ofm', 'source-layer': 'boundary', filter: borders('region'), paint: { 'line-color': t.borderRegion.color, 'line-opacity': t.borderRegion.opacity, 'line-width': 0.6, 'line-dasharray': [3, 2] } },
    {
      id: 'border-country', type: 'line', source: 'ofm', 'source-layer': 'boundary', filter: borders('country'),
      paint: {
        'line-color': t.borderCountry.color, 'line-opacity': t.borderCountry.opacity,
        'line-width': countryBorderWidth(...t.borderCountry.width) as never,
        ...(t.borderCountry.dash ? { 'line-dasharray': t.borderCountry.dash } : {}),
      },
    },
  ] as StyleSpecification['layers'];
}

// ───────────────────────── палитры (источник — спецификация, истории 71, 72, 74) ─────────────────────────

const EXPEDITION = {
  /** Глубокие тени — navy/obsidian, а не зелёный графит (V3). */
  shadow: '#0B1526', text: '#F5F0E5', line: '#FF6654', core: '#FFF1CD', secondary: '#BFC9BF',
  /** Тёплый свет рельефа и общий тёплый тон. */
  warm: '#FFE2B8',
  /** Свет отмывки: тот же тёплый тон, но с прозрачностью — не заливает склон. */
  warmLight: 'rgba(255,226,184,0.34)',
};
const ATLAS = {
  sheet: '#F4F0E6', water: '#D8E5E1', land: '#ECE7D8', border: '#B7BDAF',
  text: '#243B35', line: '#A63F2A', secondary: '#6F8174',
};
const NEON = {
  bg: '#0C1420', land: '#142235', water: '#08101A', line: '#67D9DB', accent: '#D99DB8', text: '#EAF4F3',
};

export const STYLES: Record<StyleId, StyleDef> = {
  epic: {
    id: 'epic',
    nameRu: 'Экспедиция',
    nameEn: 'Expedition',
    descriptionRu: 'Спутник и рельеф DEM, тёплый свет и светящийся коралловый маршрут.',
    mapStyle: {
      version: 8,
      name: 'route-story-expedition',
      sky: { 'sky-color': '#152539', 'horizon-color': '#CABCA2', 'fog-color': '#A3B6CC',
        'sky-horizon-blend': 0.8, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.2 },
      sources: {
        ofm: { type: 'vector', url: OPENFREEMAP, attribution: OFM_ATTRIBUTION },
        imagery: {
          type: 'raster', tiles: [ESRI_IMAGERY], tileSize: 256, maxzoom: 19,
          attribution: ESRI_IMAGERY_ATTRIBUTION,
        },
        dem: {
          type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, maxzoom: 14, encoding: 'terrarium',
          attribution: AWS_ATTRIBUTION,
        },
        demShade: { type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, maxzoom: 12, encoding: 'terrarium' },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': EXPEDITION.shadow } },
        {
          // сниженная насыщенность и приглушённые светлые земли; тени и тёплый свет подтягивает общий тон сцены
          id: 'imagery', type: 'raster', source: 'imagery',
          paint: { 'raster-saturation': -0.15, 'raster-contrast': 0.15, 'raster-brightness-max': 0.92, 'raster-fade-duration': 0 },
        },
        {
          // отмывка под тёплый свет слева сверху: объём рельефа читается и на общем плане, где наклона нет
          id: 'hills', type: 'hillshade', source: 'demShade',
          paint: {
            'hillshade-exaggeration': 0.62,
            'hillshade-shadow-color': EXPEDITION.shadow,
            // тёплый свет — полупрозрачный: сплошной закрывал спутник «песком» на ровных склонах (triglav, z13+)
            'hillshade-highlight-color': EXPEDITION.warmLight,
            'hillshade-accent-color': EXPEDITION.shadow,
            'hillshade-illumination-direction': 315,
            'hillshade-illumination-anchor': 'map',
          },
        },
        // Детали строго из OpenStreetMap: никаких декоративных дорог или зданий.
        { id: 'geo-rivers', type: 'line', source: 'ofm', 'source-layer': 'waterway', minzoom: 9,
          paint: { 'line-color': '#82B7C1', 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 15, 1.5] } },
        { id: 'geo-roads', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 9,
          filter: cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'path'),
          paint: { 'line-color': '#EADCBF', 'line-opacity': 0.48, 'line-width': roadWidth(0.55) as never } },
        { id: 'geo-buildings', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 13,
          paint: { 'fill-color': '#D7C7AE', 'fill-opacity': 0.35 } },
      ],
      terrain: { source: 'dem', exaggeration: 1.8 },
    },
    terrain: { exaggeration: 1.8 },
    pitch: 64,
    palette: {
      line: EXPEDITION.line, lineGlow: EXPEDITION.line, ghost: 'rgba(245,240,229,0.42)', transfer: EXPEDITION.text,
      text: EXPEDITION.text, cardBg: 'rgba(11,21,38,0.66)', accent: EXPEDITION.line, secondary: EXPEDITION.secondary,
    },
    type: {
      title: { family: MANROPE, weight: 800, min: 96, max: 112, tracking: -0.025 },
      number: { family: MANROPE, weight: 700, size: 72 },
      label: { family: MANROPE, weight: 600, size: 32 },
      secondary: { family: MANROPE, weight: 500, size: 30 },
      kicker: { family: MANROPE, weight: 700, size: 28, tracking: 0.1 },
    },
    fonts: { title: fontStack(MANROPE), numbers: fontStack(MANROPE), label: fontStack(MANROPE) },
    line: {
      width: 7, color: EXPEDITION.line, core: EXPEDITION.core,
      glow: 0.5, glowColor: '#FF9A62', glowBlend: 'lighter',
      ghost: 'rgba(255,130,105,0.32)', ghostCasing: 'rgba(8,15,28,0.4)',
      gap: EXPEDITION.text, dash: [2.4, 2.1],
      // тёмная подложка шире линии: коралловый цвет читается на песке, снегу и воде
      casing: { color: 'rgba(8,15,28,0.92)', scale: 2.1 },
    },
    marker: { fill: '#FFF6DC', ring: EXPEDITION.line, radius: 11, ringWidth: 3, ringGap: 7, glow: 0, labelRadius: 13 },
    motion: { appear: 'fade-rise', rise: 28, appearSec: 0.7 },
    defaultInfo: info('distance', 'progress', 'country'),
    tone: {
      tints: [
        { color: '#D3D9E0', blend: 'multiply', alpha: 0.4 },     // приглушить светлые земли, чуть остудить
        { color: EXPEDITION.shadow, blend: 'lighten', alpha: 1 }, // тени — не чернее navy/obsidian
        { color: '#FFC27E', blend: 'soft-light', alpha: 0.3 },    // тёплые света
      ],
      vignette: { strength: 0.4, rgb: '4,9,20' },
      grain: 0,
      haze: { rgb: '150,172,204', height: 0.3, strength: 0.34 },
    },
    attribution: `${ESRI_IMAGERY_ATTRIBUTION} · ${OFM_ATTRIBUTION} · ${AWS_ATTRIBUTION}`,
    swatchCss: swatch('linear-gradient(160deg,#0B1526 0%,#2c3a40 40%,#7a6a4c 72%,#c2a97c 100%)', EXPEDITION.line, EXPEDITION.line, 4),
    thumb: './style-thumbs/epic.webp',
  },

  neon: {
    id: 'neon',
    nameRu: 'Неон',
    nameEn: 'Neon',
    descriptionRu: 'Строгая ночная графика: тёмная карта и одна бирюзовая линия.',
    mapStyle: {
      version: 8,
      name: 'route-story-neon',
      sources: { ofm: { type: 'vector', url: OPENFREEMAP, attribution: OFM_ATTRIBUTION } },
      layers: vectorLayers({
        sheet: NEON.bg,
        land: NEON.land, landClasses: ['wood', 'grass', 'farmland', 'sand', 'rock', 'wetland'], landuse: '#182943', park: '#16283B', building: '#1B2D45',
        water: NEON.water, waterEdge: '#101C2B', waterway: '#0F1D2E',
        roadMinor: '#1C2D44', roadMajor: '#2A4260', roadMinorW: 0.4, roadMajorW: 0.8,
        borderCountry: { color: NEON.accent, opacity: 0.5, width: [0.8, 1.6] },
        borderRegion: { color: '#3A4E69', opacity: 0.6 },
      }),
    },
    pitch: 36,
    palette: {
      line: NEON.line, lineGlow: NEON.line, ghost: 'rgba(234,244,243,0.26)', transfer: NEON.accent,
      text: NEON.text, cardBg: 'rgba(12,20,32,0.78)', accent: NEON.accent, secondary: '#9FB3BD',
    },
    type: {
      title: { family: MANROPE, weight: 700, min: 88, max: 104, tracking: -0.02 },
      number: { family: MONO, weight: 500, size: 68 },
      label: { family: MANROPE, weight: 600, size: 30 },
      secondary: { family: MANROPE, weight: 500, size: 28 },
      kicker: { family: MONO, weight: 500, size: 28, tracking: 0.1 },
    },
    fonts: { title: fontStack(MANROPE), numbers: fontStack(MONO), label: fontStack(MANROPE) },
    line: {
      width: 5, color: NEON.line, core: '#E6FBFB',
      glow: 0.6, glowColor: NEON.line, glowBlend: 'lighter',
      ghost: 'rgba(234,244,243,0.26)', ghostCasing: 'rgba(8,16,26,0.35)',
      gap: NEON.accent, dash: [2.2, 2.4],
      casing: { color: 'rgba(8,16,26,0.7)', scale: 1.6 },
    },
    marker: { fill: NEON.text, ring: NEON.accent, radius: 10, ringWidth: 3, ringGap: 6, glow: 0.5, labelRadius: 4 },
    motion: { appear: 'fade', rise: 0, appearSec: 0.35 },
    defaultInfo: info('distance', 'progress', 'country'),
    tone: { tints: [], vignette: { strength: 0.22, rgb: '2,6,12' }, grain: 0 },
    attribution: OFM_ATTRIBUTION,
    swatchCss: swatch(`radial-gradient(120% 90% at 20% 10%,${NEON.land} 0%,${NEON.bg} 62%)`, NEON.line, NEON.line, 4),
    thumb: './style-thumbs/neon.webp',
  },

  atlas: {
    id: 'atlas',
    nameRu: 'Атлас',
    nameEn: 'Atlas',
    descriptionRu: 'Светлая карта с рельефом DEM, бумажной палитрой и контрастным терракотовым маршрутом.',
    mapStyle: {
      version: 8,
      name: 'route-story-atlas',
      sky: { 'sky-color': '#809AAD', 'horizon-color': '#E9DFCA', 'fog-color': '#C9D3CC',
        'sky-horizon-blend': 0.8, 'horizon-fog-blend': 0.4, 'fog-ground-blend': 0.12 },
      sources: {
        ofm: { type: 'vector', url: OPENFREEMAP, attribution: OFM_ATTRIBUTION },
        dem: { type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: AWS_ATTRIBUTION },
        relief: { type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, maxzoom: 14, encoding: 'terrarium', attribution: AWS_ATTRIBUTION },
      },
      layers: vectorLayers({
        sheet: ATLAS.sheet,
        land: ATLAS.land, landClasses: ['wood', 'grass', 'farmland', 'wetland'], landuse: '#E7E1D0', park: '#E3E7D3', building: '#E3DDCB',
        water: ATLAS.water, waterEdge: '#C6D8D3', waterway: '#C3D6D1',
        roadMinor: '#E0DAC8', roadMajor: '#D2CBB5', roadMinorW: 0.35, roadMajorW: 0.6,
        borderCountry: { color: ATLAS.border, opacity: 1, width: [0.9, 1.8], dash: [4, 1.5] },
        borderRegion: { color: ATLAS.border, opacity: 0.55 },
      }, [
        // отмывка из AWS Terrain (вместо Esri Shaded Relief): тихий тёплый рельеф под водой и дорогами
        {
          id: 'relief', type: 'hillshade', source: 'relief',
          paint: {
            'hillshade-exaggeration': 0.28,
            'hillshade-shadow-color': '#8E907D',
            'hillshade-highlight-color': '#FFFFFF',
            'hillshade-accent-color': '#A9AB97',
            'hillshade-illumination-direction': 315,
            'hillshade-illumination-anchor': 'map',
          },
        },
      ]),
      terrain: { source: 'dem', exaggeration: 1.4 },
    },
    terrain: { exaggeration: 1.4 },
    pitch: 52,
    palette: {
      line: ATLAS.line, lineGlow: ATLAS.line, ghost: 'rgba(86,106,92,0.62)', transfer: ATLAS.line,
      text: ATLAS.text, cardBg: 'rgba(244,240,230,0.94)', accent: ATLAS.line, secondary: ATLAS.secondary,
    },
    type: {
      title: { family: SERIF, weight: 700, min: 100, max: 120, tracking: -0.015 },
      number: { family: MANROPE, weight: 600, size: 72 },
      label: { family: MANROPE, weight: 500, size: 32 },
      secondary: { family: MANROPE, weight: 500, size: 30 },
      kicker: { family: MANROPE, weight: 700, size: 28, tracking: 0.12 },
    },
    fonts: { title: fontStack(SERIF), numbers: fontStack(MANROPE), label: fontStack(MANROPE) },
    line: {
      width: 6.5, color: ATLAS.line, core: ATLAS.line,
      glow: 0, glowColor: ATLAS.line, glowBlend: 'source-over',
      ghost: 'rgba(86,106,92,0.62)', ghostCasing: 'rgba(244,240,230,0.7)',
      gap: ATLAS.line, dash: [1.8, 2],
      // светлый «бумажный» кант отделяет штрих и от суши, и от воды
      casing: { color: 'rgba(250,247,238,0.95)', scale: 1.8 },
    },
    marker: { fill: ATLAS.line, ring: ATLAS.sheet, radius: 10, ringWidth: 3.5, ringGap: 0, glow: 0, labelRadius: 3 },
    motion: { appear: 'fade-rise', rise: 10, appearSec: 0.4 },
    defaultInfo: info('distance', 'progress', 'country'),
    tone: { tints: [], vignette: { strength: 0, rgb: '0,0,0' }, grain: 0 },
    attribution: `${OFM_ATTRIBUTION} · ${AWS_ATTRIBUTION}`,
    swatchCss: swatch(`linear-gradient(160deg,${ATLAS.sheet} 0%,${ATLAS.land} 60%,${ATLAS.water} 100%)`, ATLAS.line, null, 4),
    thumb: './style-thumbs/atlas.webp',
  },
};

export const STYLE_IDS: StyleId[] = ['epic', 'neon', 'atlas'];

/**
 * Стиль карты для сцены. Подложки векторные или с одним растровым размером тайла, поэтому от pixelRatio
 * стиль не зависит; функция — единая точка, через которую сцена берёт стиль.
 */
export function mapStyleFor(id: StyleId, _pixelRatio: number, cinematic = false): StyleSpecification {
  if (!cinematic) return STYLES[id].mapStyle;
  // STYLES остаётся профилем ролей/совместимости T25. Реальная сцена получает единый DEM
  // уровня 12: геометрия и отмывка разделяют загрузку и не рисуют целочисленные ступени z14.
  const result = structuredClone(STYLES[id].mapStyle);
  if (id !== 'neon') {
    const dem = result.sources.dem;
    if (dem.type === 'raster-dem') dem.maxzoom = 12;
    delete result.sources.demShade; delete result.sources.relief;
    for (const layer of result.layers) if (layer.type === 'hillshade') {
      layer.source = 'dem';
      layer.paint = { ...layer.paint, 'hillshade-illumination-anchor': 'map',
        'hillshade-illumination-direction': 315, 'hillshade-exaggeration': id === 'epic' ? 0.55 : 0.6,
        ...(id === 'atlas' ? { 'hillshade-shadow-color': '#555F55' } : {}) };
    }
  }
  return result;
}

/** Субъективная атмосфера, не погодные измерения. Сила — доля заливки поверх карты, до титров. */
const CHAPTER_TONES: Record<ChapterMood, { rgb: [number, number, number]; strength: number }> = {
  neutral: { rgb: [0, 0, 0], strength: 0 }, cold: { rgb: [65, 112, 151], strength: 0.09 },
  heat: { rgb: [190, 108, 49], strength: 0.08 }, rain: { rgb: [58, 91, 116], strength: 0.10 },
  altitude: { rgb: [100, 142, 159], strength: 0.06 }, warmth: { rgb: [183, 137, 77], strength: 0.07 },
};
export function chapterToneFor(styleId: StyleId, state?: ChapterMoodState): { rgb: [number, number, number]; strength: number } {
  if (!state || styleId === 'neon') return { rgb: [0, 0, 0], strength: 0 };
  const rgb: [number, number, number] = [0, 0, 0]; let strength = 0;
  for (const mood of Object.keys(CHAPTER_TONES) as ChapterMood[]) {
    const tone = CHAPTER_TONES[mood], w = state.weights[mood] * tone.strength;
    strength += w;
    for (let k = 0; k < 3; k++) rgb[k] += tone.rgb[k] * w;
  }
  if (strength > 0) for (let k = 0; k < 3; k++) rgb[k] /= strength;
  return { rgb, strength: strength * (styleId === 'atlas' ? 0.65 : 1) };
}

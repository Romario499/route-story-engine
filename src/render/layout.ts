// Раскладка оформления кадра в дизайн-пикселях (1080×1920 / 1920×1080) и безопасные зоны площадок.
// Одна таблица зон на всё: её читает drawOverlay (рисует), превью (полосы «безопасных зон»), камера
// (отступы общего плана и путешествия — через overviewPaddingFor / timelineOptionsFor) и тесты.
// Все прямоугольники оформления лежат внутри рабочей зоны WORK_AREA (истории 82–83).
import type { Padding, TimelineOptions } from '../story';
import type { StyleDef } from './styles';
import { DESIGN_SIZE, type Format, type StyleId } from '../types';

export interface Rect { x: number; y: number; w: number; h: number }
export interface Insets { top: number; right: number; bottom: number; left: number }

export interface Layout {
  format: Format;
  width: number;
  height: number;
  /** Множитель типографики: размеры шрифтов берутся из StyleDef.type в дизайн-пикселях Full HD, поэтому 1 в обоих форматах. */
  scale: number;
  /** Читаемость оформления в Full HD; камера и геометрия маршрута от этих размеров не зависят. */
  readability: {
    countryScale: number; summaryScale: number; overviewLineScale: number;
    calloutTitle: number; calloutDetail: number; calloutHeight: number;
    legendSize: number; legendHeight: number;
  };
  /** Отступы безопасной зоны площадки, дизайн-пиксели: сюда нельзя ставить важное. */
  safe: Insets;
  safeRect: Rect;
  /** Рабочая зона: всё оформление — внутри неё. */
  work: Rect;
  /**
   * Слот сверху: плашка страны ИЛИ событийная подпись (старт, финиш, высшая точка…) — одна за раз,
   * поэтому двух плашек «стопкой» быть не может.
   */
  caption: Rect;
  /** Область показателей: в 9:16 прижата книзу (над профилем), в 16:9 — колонка справа, от верха по содержимому. */
  stats: Rect;
  statsAnchor: 'top' | 'bottom';
  /** Сколько колонок показателей. */
  statsColumns: 1 | 2;
  /** Профиль высот — тонкая полоса без подложки. */
  profile: Rect;
  progress: Rect;
  /** Заголовок интро и финала. */
  title: Rect;
  titleAlign: 'left';
  titleMaxLines: number;
  /** Где стоит маршрут на общем плане (интро и финал): отсюда выводятся отступы камеры. */
  route: Rect;
  /** Итоги финала и место, где они стоят относительно маршрута. */
  summary: Rect;
  summaryDock: 'bottom' | 'right';
  /** Левая граница, последняя базовая линия и ширина полной атрибуции карты. */
  attribution: { x: number; y: number; w: number };
}

/** Рабочая зона по историям 82 (9:16: x 64…900, y 240…1506) и 83 (16:9: x 96…1824, y 72…1008). */
export const WORK_AREA: Record<Format, Rect> = {
  '9:16': { x: 64, y: 240, w: 836, h: 1266 },
  '16:9': { x: 96, y: 72, w: 1728, h: 936 },
};

const SAFE: Record<Format, { top: number; right: number; bottom: number; left: number }> = {
  // Reels / Shorts: сверху — шапка приложения, снизу — подпись и кнопки, справа — лайки и комментарии
  '9:16': { top: 0.12, right: 0.12, bottom: 0.2, left: 0 },
  // YouTube: поля под безопасное по телевизору/окну плеера; низ — чуть меньше, рабочая зона доходит до y=1008
  '16:9': { top: 0.05, right: 0.04, bottom: 0.065, left: 0.04 },
};

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

/**
 * Прямоугольники оформления. `styleId` — точка расширения: сейчас геометрия у всех стилей общая
 * (координаты из историй 82–83 одинаковы), различаются оформление и типографика — их задаёт overlay.ts.
 * Без styleId — раскладка «Экспедиции».
 */
export function layoutFor(format: Format, _styleId: StyleId = 'epic'): Layout {
  const { width, height } = DESIGN_SIZE[format];
  const f = SAFE[format];
  const safe: Insets = { top: height * f.top, right: width * f.right, bottom: height * f.bottom, left: width * f.left };
  const safeRect = rect(safe.left, safe.top, width - safe.left - safe.right, height - safe.top - safe.bottom);
  const work = WORK_AREA[format];
  const wide = format === '16:9';
  // 16:9: нижняя строка атрибуции (с выносными элементами и обводкой, ~7 px под базовой линией) не касается полосы прогресса (y 994): зазор ≥ 8 px.
  const attribution = { x: work.x, y: wide ? 978 : 1516, w: work.w };
  const readability = {
    countryScale: wide ? 1.1875 : 1, summaryScale: wide ? 1.16 : 1,
    overviewLineScale: wide ? 1.22 : 1,
    calloutTitle: wide ? 34 : 28, calloutDetail: wide ? 28 : 22,
    calloutHeight: wide ? 108 : 90,
    legendSize: wide ? 24 : 22, legendHeight: wide ? 40 : 36,
  };

  if (format === '9:16') {
    const { x, w } = work;
    return {
      format, width, height, scale: 1, readability, safe, safeRect, work,
      caption: rect(x, 250, w, 124),
      stats: rect(x, 1040, w, 366), statsAnchor: 'bottom', statsColumns: 2,
      profile: rect(x, 1324, w, 82),
      progress: rect(x, 1426, w, 10),
      title: rect(x, 250, w, 280), titleAlign: 'left', titleMaxLines: 3,
      route: rect(140, 570, 700, 490),
      summary: rect(x, 1080, w, 360), summaryDock: 'bottom',
      attribution,
    };
  }
  return {
    format, width, height, scale: 1, readability, safe, safeRect, work,
    caption: rect(96, 100, 760, 124),
    stats: rect(1390, 96, 434, 700), statsAnchor: 'top', statsColumns: 1,
    profile: rect(96, 900, 1728, 80),
    progress: rect(96, 994, 1728, 10),
    title: rect(96, 72, 1080, 220), titleAlign: 'left', titleMaxLines: 2,
    route: rect(240, 322, 964, 554),
    summary: rect(1354, 300, 470, 520), summaryDock: 'right',
    attribution,
  };
}

/** Безопасные зоны в долях кадра — из них превью строит красные полосы (никаких отдельных CSS-процентов). */
export function safeZoneFractions(format: Format): { top: number; bottom: number; right: number; left: number } {
  const { safe, width, height } = layoutFor(format);
  return { top: safe.top / height, bottom: safe.bottom / height, right: safe.right / width, left: safe.left / width };
}

/**
 * Отступы общего плана (интро и финал) в CSS-пикселях MAP_VIEWPORT (= дизайн-пиксели / 2): маршрут занимает
 * `layout.route`; сверху остаётся место под заголовок, снизу или справа — под итоги, по бокам — под подписи
 * старта и финиша. Единственный источник отступов для камеры, превью и экспорта.
 */
export function overviewPaddingFor(format: Format, styleId: StyleId = 'epic'): Padding {
  const l = layoutFor(format, styleId);
  const r = l.route;
  return {
    top: r.y / 2,
    left: r.x / 2,
    right: (l.width - r.x - r.w) / 2,
    bottom: (l.height - r.y - r.h) / 2,
  };
}

/**
 * Отступы путешествия (CSS-пиксели карты): зоны оформления, куда «голова» маршрута заходить не должна —
 * подпись сверху слева, колонка показателей справа (16:9) или показатели внизу (9:16), профиль высот.
 * Камера держит голову в центре оставшейся свободной области.
 */
export function journeyPaddingFor(format: Format, styleId: StyleId = 'epic'): Padding {
  const l = layoutFor(format, styleId);
  if (format === '9:16') {
    // показатели по умолчанию — один-два ряда; три ряда — уже по желанию пользователя
    return { top: (l.caption.y + l.caption.h + 20) / 2, right: 0, bottom: (l.height - (l.stats.y + l.stats.h - 2 * 140)) / 2, left: 0 };
  }
  return {
    top: (l.caption.y + l.caption.h + 20) / 2,
    right: (l.width - l.stats.x + 30) / 2,
    bottom: (l.height - l.profile.y + 20) / 2,
    left: 0,
  };
}

/** Опции раскадровки для `buildTimeline`: превью и экспорт берут их из одной функции, чтобы кадры совпадали. */
export function timelineOptionsFor(format: Format, styleId: StyleId = 'epic'): TimelineOptions {
  return {
    cinematic: true,
    maxPitch: styleId === 'neon' ? 36 : 74,
    // Консервативный потолок возле native DEM z14. Ограничивает переходы LOD;
    // Полную готовность покрывающих тайлов проверяет сцена; неполные кадры не кодируются.
    maxJourneyZoom: styleId === 'neon' ? 16.5 : 13.9,
    overviewPadding: overviewPaddingFor(format, styleId),
    journeyPadding: journeyPaddingFor(format, styleId),
  };
}

/**
 * Консервативные границы полного титра по меткам (заголовок, оговорка, автор) и итогов.
 * Включают максимальный сдвиг появления: track рисуется до overlay и не получает текст настроек.
 * Заголовок ограничен title.h в layoutTitle; интервалы служебных строк совпадают с titleGeometry.
 * Дизайн-пиксели, как остальные зоны оформления. GPX использует прежнее размещение подписей.
 */
export function waypointOverviewObstacles(format: Format, style: StyleDef, purpose: 'labels' | 'lines' = 'labels'): Rect[] {
  const { title, summary, attribution } = layoutFor(format, style.id);
  const rise = style.motion.appear === 'fade-rise' ? style.motion.rise : 0;
  const afterTitle = 16 + 22 + style.type.kicker.size * 0.9 + 14 + style.type.secondary.size * 0.9 + 12;
  const pad = 24; // в том числе тень заголовка
  return [
    { x: title.x - pad, y: title.y - pad, w: title.w + pad * 2, h: title.h + afterTitle + rise + pad * 2 },
    { x: summary.x - pad, y: summary.y - pad, w: summary.w + pad * 2, h: summary.h + rise + pad * 2 },
    // Атрибуция защищена только от подписей; соединения меток проходят без обрезки.
    ...(purpose === 'labels' ? [{ x: attribution.x - 6, y: attribution.y - (format === '9:16' ? 76 : 46),
      w: attribution.w + 12, h: format === '9:16' ? 92 : 51 }] : []),
  ];
}

/** Тот же событийный слот; дополнительные строки главы помещаются до области карты. */
export function chapterCaptionRect(format: Format, styleId?: StyleId): Rect {
  const r = layoutFor(format, styleId).caption;
  return { ...r, h: 210 };
}

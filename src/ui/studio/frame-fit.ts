// Геометрия сцены в студии: вписать кадр (CSS-размер MAP_VIEWPORT) в доступную область. Чистая функция — тестируется без DOM.

export interface Box { width: number; height: number }
export interface FittedFrame { scale: number; width: number; height: number }

/** Ширина окна, до которой студия переходит в одну колонку (сцена не уже ~420 px: 320 панель + поля и зазор + 420). */
export const SINGLE_COLUMN_QUERY = '(max-width: 819px)';
/** Три колонки (маршрут | сцена | стиль и экспорт) — от этой ширины; ниже, до одной колонки, — сцена и одна боковая колонка. */
export const WIDE_QUERY = '(min-width: 1024px)';
/** Одна колонка: кадр не выше этой доли высоты окна, чтобы за ним были видны транспорт и настройки. */
export const SINGLE_COLUMN_MAX_HEIGHT_RATIO = 0.72;

/**
 * Вписывает кадр `viewport` в `avail`: 9:16 упирается в высоту, 16:9 — в ширину или высоту.
 * Больше натурального размера не увеличиваем (превью — тот же рендер, растягивать его — терять резкость).
 */
export function fitFrame(avail: Box, viewport: Box, maxScale = 1): FittedFrame {
  const w = Math.max(0, avail.width);
  const h = Math.max(0, avail.height);
  const scale = Math.max(0, Math.min(maxScale, w / viewport.width, h / viewport.height));
  return { scale, width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) };
}

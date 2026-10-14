// Ресурсы оформления: SVG-флаги стран из flag-icons (эмодзи-флаги в Windows не рисуются).
// Флаги грузятся лениво по одному, кэшируются как готовые Image; рисовать нужно только после
// `preloadOverlayAssets(...)` — превью и экспорт ждут её до первого кадра, иначе кадр уйдёт без флага.
import type { Enrichment } from '../types';

/** Ленивые загрузчики SVG: ключ — путь файла, значение — функция, отдающая URL ресурса. */
const FLAG_LOADERS = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

const flagLoaderByIso = new Map<string, () => Promise<string>>();
for (const [path, loader] of Object.entries(FLAG_LOADERS)) {
  const iso = /([^/]+)\.svg$/.exec(path)?.[1];
  if (iso) flagLoaderByIso.set(iso.toLowerCase(), loader);
}

const flagCache = new Map<string, HTMLImageElement | null>();
const flagPending = new Map<string, Promise<HTMLImageElement | null>>();

/** Флаг из кэша; null — ещё не загружен (или такого флага нет). Запускает загрузку, если её не было. */
export function getFlag(iso2: string): HTMLImageElement | null {
  const key = iso2.toLowerCase();
  const hit = flagCache.get(key);
  if (hit) return hit;
  if (hit === undefined) void loadFlag(key);
  return null;
}

/** Загрузить и декодировать флаг; null — если файла нет или среда без Image (тесты в Node). */
export function loadFlag(iso2: string): Promise<HTMLImageElement | null> {
  const key = iso2.toLowerCase();
  if (flagCache.has(key)) return Promise.resolve(flagCache.get(key) ?? null);
  const pending = flagPending.get(key);
  if (pending) return pending;
  const loader = flagLoaderByIso.get(key);
  if (!loader || typeof Image === 'undefined') {
    flagCache.set(key, null);
    return Promise.resolve(null);
  }
  const p = (async () => {
    try {
      const url = await loader();
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      flagCache.set(key, img);
      return img;
    } catch {
      flagCache.set(key, null); // флаг не критичен: вместо него код страны
      return null;
    } finally {
      flagPending.delete(key);
    }
  })();
  flagPending.set(key, p);
  return p;
}

/** Страны, чьи флаги нужны ролику: все посещённые и страны битов. */
export function flagsNeeded(enrichment: Enrichment | null): string[] {
  if (!enrichment) return [];
  const set = new Set<string>();
  for (const c of enrichment.countries) set.add(c.iso2.toLowerCase());
  for (const b of enrichment.beats) if (b.country) set.add(b.country.iso2.toLowerCase());
  return [...set];
}

/**
 * Дождаться всего, что рисует оформление: флагов маршрута. Превью зовёт её перед первым кадром,
 * экспорт — перед первым кадром файла (иначе кадр уйдёт без флага).
 */
export async function preloadOverlayAssets(enrichment: Enrichment | null): Promise<void> {
  await Promise.all(flagsNeeded(enrichment).map((iso) => loadFlag(iso)));
}

// ───────────────────────── иконки ─────────────────────────
// Рисуются контуром прямо на холсте (никаких файлов и шрифтов-иконок): единый штрих, цвет и толщина — от стиля.

export type IconKind = 'distance' | 'day' | 'date' | 'city' | 'altitude' | 'speed' | 'progress' | 'start' | 'finish' | 'peak' | 'waypoint' | 'gap'
  | 'tent' | 'train' | 'unicycle';

/** Иконка в квадрате size с центром (cx, cy); рисуется штрихом color. */
export function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, cx: number, cy: number, size: number, color: string): void {
  const k = size / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, k);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 0.17;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
  ctx.beginPath();
  const dot = (x: number, y: number, r: number, fill = false) => {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fill(); ctx.beginPath(); }
  };
  const calendar = () => {
    ctx.moveTo(-0.62, -0.7); ctx.lineTo(0.62, -0.7);
    ctx.arcTo(0.82, -0.7, 0.82, -0.5, 0.2); ctx.lineTo(0.82, 0.62);
    ctx.arcTo(0.82, 0.82, 0.62, 0.82, 0.2); ctx.lineTo(-0.62, 0.82);
    ctx.arcTo(-0.82, 0.82, -0.82, 0.62, 0.2); ctx.lineTo(-0.82, -0.5);
    ctx.arcTo(-0.82, -0.7, -0.62, -0.7, 0.2);
    ctx.moveTo(-0.82, -0.18); ctx.lineTo(0.82, -0.18);
    ctx.moveTo(-0.38, -0.95); ctx.lineTo(-0.38, -0.5);
    ctx.moveTo(0.38, -0.95); ctx.lineTo(0.38, -0.5);
    ctx.stroke();
    ctx.beginPath();
  };
  const pin = () => {
    ctx.moveTo(0, 0.95);
    ctx.bezierCurveTo(-0.95, -0.05, -0.7, -0.92, 0, -0.92);
    ctx.bezierCurveTo(0.7, -0.92, 0.95, -0.05, 0, 0.95);
    ctx.stroke();
    ctx.beginPath();
    dot(0, -0.3, 0.26);
    ctx.stroke();
  };
  const mountain = () => {
    ctx.moveTo(-0.95, 0.7); ctx.lineTo(-0.28, -0.6); ctx.lineTo(0.12, 0.08);
    ctx.lineTo(0.42, -0.3); ctx.lineTo(0.95, 0.7); ctx.closePath();
    ctx.stroke();
  };
  switch (kind) {
    case 'distance':
      dot(-0.62, 0.58, 0.2); dot(0.62, -0.58, 0.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.42, 0.5); ctx.bezierCurveTo(0.6, 0.9, -0.7, -0.1, 0.1, -0.2);
      ctx.bezierCurveTo(0.35, -0.23, 0.45, -0.38, 0.5, -0.46);
      ctx.stroke();
      break;
    case 'day':
      calendar();
      ctx.rect(-0.28, 0.12, 0.56, 0.4);
      ctx.fill();
      break;
    case 'date':
      calendar();
      dot(-0.4, 0.2, 0.1, true); dot(0.05, 0.2, 0.1, true); dot(0.45, 0.2, 0.1, true);
      dot(-0.4, 0.58, 0.1, true); dot(0.05, 0.58, 0.1, true);
      break;
    case 'city':
    case 'waypoint':
      pin();
      break;
    case 'altitude':
    case 'peak':
      mountain();
      break;
    case 'speed':
      dot(0, 0, 0.88);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0.42, -0.44);
      ctx.moveTo(-0.62, 0.34); ctx.lineTo(-0.5, 0.28);
      ctx.moveTo(-0.46, -0.46); ctx.lineTo(-0.38, -0.38);
      ctx.moveTo(0, -0.7); ctx.lineTo(0, -0.58);
      ctx.stroke();
      ctx.beginPath();
      dot(0, 0, 0.12, true);
      break;
    case 'progress':
      // кольцо с пройденной дугой
      {
        const a = ctx.globalAlpha;
        ctx.globalAlpha = a * 0.45;
        dot(0, 0, 0.8);
        ctx.stroke();
        ctx.globalAlpha = a;
      }
      ctx.beginPath();
      ctx.lineWidth = 0.3;
      ctx.arc(0, 0, 0.8, -Math.PI / 2, Math.PI * 0.62);
      break;
    case 'gap':
      // пунктирный разрыв между двумя точками
      dot(-0.82, 0, 0.14, true); dot(0.82, 0, 0.14, true);
      ctx.moveTo(-0.5, 0); ctx.lineTo(-0.28, 0);
      ctx.moveTo(-0.08, 0); ctx.lineTo(0.14, 0);
      ctx.moveTo(0.34, 0); ctx.lineTo(0.52, 0);
      break;
    case 'tent':
      // Палатка с отдельным широким входом под крышей: нет штриха от вершины, похожего на предупреждение.
      ctx.moveTo(-0.85, 0.62); ctx.lineTo(0, -0.78); ctx.lineTo(0.85, 0.62); ctx.closePath();
      ctx.moveTo(-0.32, 0.62); ctx.lineTo(-0.32, 0.05); ctx.lineTo(0, -0.28);
      ctx.lineTo(0.32, 0.05); ctx.lineTo(0.32, 0.62);
      ctx.moveTo(-1, 0.62); ctx.lineTo(1, 0.62);
      break;
    case 'train':
      // поезд спереди: кузов, лобовое окно, фары и рельсы
      ctx.rect(-0.62, -0.88, 1.24, 1.32);
      ctx.moveTo(-0.62, -0.1); ctx.lineTo(0.62, -0.1);
      ctx.moveTo(-0.42, -0.6); ctx.lineTo(0.42, -0.6);
      ctx.moveTo(-0.55, 0.9); ctx.lineTo(-0.3, 0.44);
      ctx.moveTo(0.55, 0.9); ctx.lineTo(0.3, 0.44);
      dot(-0.32, 0.18, 0.09, true); dot(0.32, 0.18, 0.09, true);
      break;
    case 'unicycle':
      // уницикл: колесо, стойка и седло
      dot(0, 0.38, 0.5);
      ctx.moveTo(0, -0.12); ctx.lineTo(0, -0.62);
      ctx.moveTo(-0.34, -0.7); ctx.lineTo(0.34, -0.7);
      break;
    case 'start':
      dot(0, 0, 0.72);
      ctx.stroke();
      ctx.beginPath();
      dot(0, 0, 0.3, true);
      break;
    case 'finish':
      ctx.moveTo(-0.62, 0.95); ctx.lineTo(-0.62, -0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-0.62, -0.85); ctx.bezierCurveTo(-0.1, -1.05, 0.2, -0.55, 0.85, -0.7);
      ctx.lineTo(0.85, 0.05); ctx.bezierCurveTo(0.2, 0.2, -0.1, -0.3, -0.62, -0.1);
      ctx.closePath();
      ctx.fill();
      break;
  }
  ctx.stroke();
  ctx.restore();
}

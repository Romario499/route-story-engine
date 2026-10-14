import { describe, expect, it } from 'vitest';
import {
  WORK_AREA, journeyPaddingFor, layoutFor, overviewPaddingFor, safeZoneFractions, timelineOptionsFor, type Rect,
} from '../../src/render/layout';
import { fitBounds } from '../../src/story';
import { TILE_SIZE, mercX, mercY } from '../../src/story/mercator';
import { DESIGN_SIZE, MAP_VIEWPORT, type Format, type StyleId } from '../../src/types';

const inside = (r: Rect, outer: Rect) =>
  r.x >= outer.x - 0.5 && r.y >= outer.y - 0.5 && r.x + r.w <= outer.x + outer.w + 0.5 && r.y + r.h <= outer.y + outer.h + 0.5;

const FORMATS: Format[] = ['9:16', '16:9'];
const STYLE_IDS: StyleId[] = ['epic', 'atlas', 'neon'];
const RECT_KEYS = ['caption', 'stats', 'profile', 'progress', 'title', 'route', 'summary'] as const;

describe('WORK_AREA: рабочая зона по историям 82 и 83', () => {
  it('9:16 — x 64…900, y 240…1506; 16:9 — x 96…1824, y 72…1008', () => {
    expect(WORK_AREA['9:16']).toEqual({ x: 64, y: 240, w: 836, h: 1266 });
    expect(WORK_AREA['16:9']).toEqual({ x: 96, y: 72, w: 1728, h: 936 });
  });

  it.each(FORMATS)('%s: все прямоугольники оформления внутри рабочей зоны, у всех стилей', (format) => {
    for (const styleId of STYLE_IDS) {
      const l = layoutFor(format, styleId);
      expect(l.work).toEqual(WORK_AREA[format]);
      for (const key of RECT_KEYS) expect(inside(l[key], WORK_AREA[format]), `${styleId} ${key} внутри рабочей зоны`).toBe(true);
    }
  });

  it.each(FORMATS)('%s: рабочая зона лежит в безопасной зоне площадки', (format) => {
    const l = layoutFor(format);
    expect(inside(WORK_AREA[format], l.safeRect)).toBe(true);
  });
});

describe('layoutFor 9:16: композиция по истории 82', () => {
  const l = layoutFor('9:16');

  it('интро — заголовок слева x=64, y≈250, не больше 836×280, до трёх строк', () => {
    expect(l.title.x).toBe(64);
    expect(l.title.y).toBeGreaterThanOrEqual(248);
    expect(l.title.y).toBeLessThanOrEqual(256);
    expect(l.title.w).toBeLessThanOrEqual(836);
    expect(l.title.h).toBeLessThanOrEqual(280);
    expect(l.titleMaxLines).toBe(3);
    expect(l.titleAlign).toBe('left');
  });

  it('путь — одна подпись сверху, показатели внизу в 2 колонки над профилем и прогрессом', () => {
    expect(l.caption.y).toBeLessThan(l.height * 0.25);
    expect(l.statsColumns).toBe(2);
    expect(l.statsAnchor).toBe('bottom');
    expect(l.stats.y + l.stats.h).toBeLessThanOrEqual(l.profile.y + l.profile.h);
    expect(l.profile.y + l.profile.h).toBeLessThanOrEqual(l.progress.y);
  });

  it('финал — маршрут в y≈570…1060, итоги в y≈1140…1500', () => {
    expect(l.route.y).toBe(570);
    expect(l.route.y + l.route.h).toBe(1060);
    expect(l.summaryDock).toBe('bottom');
    expect(l.summary.y).toBe(1140);
    expect(l.summary.y + l.summary.h).toBe(1500);
    // заголовок финала заканчивается выше маршрута
    expect(l.title.y + l.title.h).toBeLessThanOrEqual(l.route.y);
  });
});

describe('layoutFor 16:9: композиция по истории 83', () => {
  const l = layoutFor('16:9');

  it('заголовок x=96, y=72, не больше 1080×220, до двух строк', () => {
    expect(l.title).toMatchObject({ x: 96, y: 72 });
    expect(l.title.w).toBeLessThanOrEqual(1080);
    expect(l.title.h).toBeLessThanOrEqual(220);
    expect(l.titleMaxLines).toBe(2);
  });

  it('показатели — узкая колонка x 1390…1824 от верха, а не на всю высоту', () => {
    expect(l.stats.x).toBe(1390);
    expect(l.stats.x + l.stats.w).toBe(1824);
    expect(l.statsAnchor).toBe('top');
    expect(l.statsColumns).toBe(1);
    expect(l.stats.h).toBeLessThan(l.height * 0.75);
    expect(l.stats.y + l.stats.h).toBeLessThanOrEqual(l.profile.y);
  });

  it('финал — итоги справа 430–500 × 420–560; маршрут слева от них', () => {
    expect(l.summaryDock).toBe('right');
    expect(l.summary.w).toBeGreaterThanOrEqual(430);
    expect(l.summary.w).toBeLessThanOrEqual(500);
    expect(l.summary.h).toBeGreaterThanOrEqual(420);
    expect(l.summary.h).toBeLessThanOrEqual(560);
    expect(l.route.x + l.route.w).toBeLessThan(l.summary.x);
  });

  it('профиль высот — тонкая полоса внизу, не карточка', () => {
    expect(l.profile.h).toBeLessThanOrEqual(90);
    expect(l.profile.y).toBeGreaterThan(l.height * 0.8);
    expect(l.profile.w).toBe(WORK_AREA['16:9'].w);
  });
});

describe('layoutFor: финал не перекрывает маршрут', () => {
  const apart = (a: Rect, b: Rect) => a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;

  it.each(FORMATS)('%s: заголовок и итоги стоят вне прямоугольника маршрута; подпись слота и колонка показателей — тоже', (format) => {
    for (const styleId of STYLE_IDS) {
      const l = layoutFor(format, styleId);
      expect(apart(l.title, l.route), `${styleId} заголовок`).toBe(true);
      expect(apart(l.summary, l.route), `${styleId} итоги`).toBe(true);
    }
  });
});

describe('layoutFor: безопасные зоны', () => {
  it('9:16 — верхние 12%, нижние 20% и правые 12% кадра свободны от важного', () => {
    const l = layoutFor('9:16');
    const { width, height } = DESIGN_SIZE['9:16'];
    expect(l.safe.top).toBeCloseTo(height * 0.12, 5);
    expect(l.safe.bottom).toBeCloseTo(height * 0.2, 5);
    expect(l.safe.right).toBeCloseTo(width * 0.12, 5);
  });

  it('безопасные зоны для превью — доли кадра из тех же отступов', () => {
    const f = safeZoneFractions('9:16');
    expect(f.top).toBeCloseTo(0.12, 8);
    expect(f.bottom).toBeCloseTo(0.2, 8);
    expect(f.right).toBeCloseTo(0.12, 8);
    expect(f.left).toBe(0);
    const g = safeZoneFractions('16:9');
    const l = layoutFor('16:9');
    expect(g.top).toBeCloseTo(l.safe.top / DESIGN_SIZE['16:9'].height, 8);
    expect(g.right).toBeCloseTo(l.safe.right / DESIGN_SIZE['16:9'].width, 8);
  });
});

describe('overviewPaddingFor: общий план не прячется под оформлением', () => {
  it.each(FORMATS)('%s — отступы покрывают заголовок и итоги, карте остаётся место', (format) => {
    const l = layoutFor(format);
    const pad = overviewPaddingFor(format);
    const vp = MAP_VIEWPORT[format];
    // отступ в CSS-пикселях карты = дизайн-пиксели / 2
    expect(pad.top * 2).toBeGreaterThanOrEqual(l.title.y + l.title.h);
    if (l.summaryDock === 'bottom') expect(pad.bottom * 2).toBeGreaterThanOrEqual(DESIGN_SIZE[format].height - l.summary.y - 1);
    else expect(pad.right * 2).toBeGreaterThanOrEqual(DESIGN_SIZE[format].width - l.summary.x - 1);
    expect(vp.width - pad.left - pad.right).toBeGreaterThan(vp.width * 0.4);
    expect(vp.height - pad.top - pad.bottom).toBeGreaterThan(vp.height * 0.2);
  });

  it('9:16: итоги внизу — карта в среднем поясе; 16:9: итоги справа — карта слева', () => {
    const p916 = overviewPaddingFor('9:16');
    expect(p916.bottom).toBeGreaterThan(p916.right);
    const p169 = overviewPaddingFor('16:9');
    expect(p169.right).toBeGreaterThan(p169.left);
  });

  it('вытянутые маршруты: bbox после fitBounds целиком в прямоугольнике маршрута (подписи старта и финиша не режутся)', () => {
    const shapes: [string, [number, number, number, number]][] = [
      ['с запада на восток', [28, 40, 80, 43]],
      ['с севера на юг', [37, 8, 40, 52]],
      ['почти точка', [40, 41, 40.01, 41.005]],
      ['обычный', [26, 36, 80, 52]],
    ];
    for (const format of FORMATS) {
      const l = layoutFor(format);
      const vp = MAP_VIEWPORT[format];
      for (const [name, bbox] of shapes) {
        const { center, zoom } = fitBounds(bbox, vp, overviewPaddingFor(format));
        const world = TILE_SIZE * 2 ** zoom;
        const toPx = (lon: number, lat: number) => ({
          x: (mercX(lon) - mercX(center[0])) * world + vp.width / 2,
          y: (mercY(lat) - mercY(center[1])) * world + vp.height / 2,
        });
        const a = toPx(bbox[0], bbox[3]);
        const b = toPx(bbox[2], bbox[1]);
        // дизайн-пиксели = CSS × 2
        const px = { x: a.x * 2, y: a.y * 2, w: (b.x - a.x) * 2, h: (b.y - a.y) * 2 };
        expect(inside(px, l.route), `${format} «${name}»: bbox ${JSON.stringify(px)} внутри ${JSON.stringify(l.route)}`).toBe(true);
      }
    }
  });
});

describe('timelineOptionsFor: превью и экспорт берут опции раскадровки из одной функции', () => {
  it.each(FORMATS)('%s — отступы общего плана и путешествия те же, что у layout', (format) => {
    for (const styleId of STYLE_IDS) {
      const opts = timelineOptionsFor(format, styleId);
      expect(opts.overviewPadding).toEqual(overviewPaddingFor(format, styleId));
      expect(opts.journeyPadding).toEqual(journeyPaddingFor(format, styleId));
    }
  });

  it('отступы путешествия обходят оформление: 9:16 — подпись сверху и показатели снизу; 16:9 — колонку справа', () => {
    const p916 = journeyPaddingFor('9:16');
    const l916 = layoutFor('9:16');
    expect(p916.top * 2).toBeGreaterThanOrEqual(l916.caption.y + l916.caption.h);
    expect(p916.bottom * 2).toBeGreaterThan(DESIGN_SIZE['9:16'].height - l916.stats.y - l916.stats.h);
    const p169 = journeyPaddingFor('16:9');
    const l169 = layoutFor('16:9');
    expect(p169.right * 2).toBeGreaterThanOrEqual(DESIGN_SIZE['16:9'].width - l169.stats.x);
    // голова остаётся в кадре: свободная область не вырождается
    for (const [pad, vp] of [[p916, MAP_VIEWPORT['9:16']], [p169, MAP_VIEWPORT['16:9']]] as const) {
      expect(vp.width - pad.left - pad.right).toBeGreaterThan(vp.width * 0.4);
      expect(vp.height - pad.top - pad.bottom).toBeGreaterThan(vp.height * 0.3);
    }
  });
});

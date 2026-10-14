// «Рядом» не врёт: показывается ближайшее место, а когда его нет (дальше 40 км) — гаснет (ревью F10).
// Короткие смены места не вливаются в первое место цепочки: «Трабзон» не держится, пока голова уже в Армении.
import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import type { Enrichment, Place } from '../../src/types';
import { enrichmentFor, lineRoute, settings } from './fixtures';

const route = lineRoute(1000);
const GAP_FROM = 400, GAP_TO = 600;
/** Место каждые 3 точки (смены чаще раза в секунду), на отрезке 400–600 — «ничего рядом». */
const placeOf = (i: number): Place | null => {
  if (i >= GAP_FROM && i < GAP_TO) return null;
  const k = Math.floor(i / 3) * 3;
  return { nameRu: `П${k}`, nameEn: `P${k}`, lat: route.points[k].lat, lon: route.points[k].lon, pop: 1 };
};
const enr: Enrichment = { ...enrichmentFor(route), placeAt: placeOf };
const tl = buildTimeline(route, enr, settings({ durationSec: 30 }));
const journey = Array.from({ length: 30 * 30 + 1 }, (_, k) => tl.frameAt(k / 30)).filter((f) => f.act === 'journey' && f.head > 0);

const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

describe('«рядом» следует за маршрутом', () => {
  it('показанное место — рядом с головой, а не первое место цепочки коротких смен', () => {
    const shown = journey.filter((f) => f.stats.place);
    expect(shown.length).toBeGreaterThan(50);
    for (const f of shown) {
      const head = route.points[Math.min(route.points.length - 1, Math.floor(f.head))];
      // запаздывание — не больше одной смены в секунду (≈ 4 км на этом треке), а не десятки километров
      expect(km(f.stats.place!, head), `t=${f.t.toFixed(2)} head=${f.head.toFixed(0)}`).toBeLessThan(8);
    }
  });

  it('когда ближайшего места нет (placeAt = null), «рядом» гаснет: stats.place null и placeChange.visible false', () => {
    const inGap = journey.filter((f) => f.head >= GAP_FROM + 40 && f.head < GAP_TO - 1);
    expect(inGap.length).toBeGreaterThan(20);
    for (const f of inGap) {
      expect(f.stats.place, `t=${f.t.toFixed(2)}`).toBeNull();
      expect(f.placeChange!.visible).toBe(false);
    }
    // до и после отрезка место снова есть
    expect(journey.some((f) => f.head < GAP_FROM - 40 && f.stats.place)).toBe(true);
    expect(journey.some((f) => f.head > GAP_TO + 40 && f.stats.place)).toBe(true);
  });
});

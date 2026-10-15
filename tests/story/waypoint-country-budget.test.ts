import { expect, it } from 'vitest';
import { paceWithChapterReading, type ReadingBudget } from '../../src/story/chapters';
import { buildTimeline } from '../../src/story/timeline';
import type { PacePlan } from '../../src/story/pace';
import type { Chapter, Country, Enrichment } from '../../src/types';
import { MAP_VIEWPORT } from '../../src/types';
import { timelineOptionsFor, journeyPaddingFor, layoutFor } from '../../src/render/layout';
import { mercX, mercY } from '../../src/story/mercator';
import { enrichmentFor, settings } from './fixtures';
import { confirmedWaypointRoute, jw } from './waypoint-fixtures';

const chapter: Chapter = { id: 'fiction', title: { ru: 'Глава', en: 'Chapter' },
  text: { ru: 'Вымышленный регион.', en: 'Fictional region.' }, source: 'traveler', mood: 'rain', anchor: { countries: ['C0'] } };

it('первая, последняя, одиночная метка и повторное посещение имеют отдельные резервы; время прибытия обратимо', () => {
  const base: PacePlan = { moveSec: 45.7, cruiseMps: 100, timeOfIdx: i => i * 45.7 / 9, headAt: t => Math.max(0, Math.min(9, t * 9 / 45.7)) };
  const runs = [{ fromIdx: 0, toIdx: 2 }, { fromIdx: 3, toIdx: 3 }, { fromIdx: 4, toIdx: 6 }, { fromIdx: 7, toIdx: 9 }];
  const budget: ReadingBudget = { runs, last: 9, labelSec: 3.1, firstDelaySec: 0.55 };
  const matched = [{ chapter, fromIdx: 0, toIdx: 1 }, { chapter: { ...chapter, id: 'other' }, fromIdx: 4, toIdx: 5 }];
  const p = paceWithChapterReading(base, matched, 45.7, () => 4, budget);
  expect(budget.result?.feasible).toBe(true);
  for (const r of runs) expect(p.departureOfIdx!(r.toIdx) - p.timeOfIdx(r.fromIdx)).toBeGreaterThanOrEqual(3.1 - 1e-9);
  for (const m of matched) expect(p.timeOfIdx(m.toIdx) - p.timeOfIdx(m.fromIdx)).toBeGreaterThanOrEqual(4.1 - 1e-9);
  expect(p.departureOfIdx!(3) - p.timeOfIdx(3)).toBeGreaterThanOrEqual(3.1 - 1e-9);
  expect(p.headAt(p.timeOfIdx(3) + 1)).toBe(3);
  for (let i = 0; i <= 9; i++) expect(p.headAt(p.timeOfIdx(i))).toBeCloseTo(i, 8);
  let previous = 0;
  for (let k = 0; k <= 45.7 * 120; k++) { const h = p.headAt(k / 120); expect(h).toBeGreaterThanOrEqual(previous); previous = h; }
  expect(p.headAt(45.7)).toBe(9);
  expect(p.departureOfIdx!(9)).toBe(45.7);
});

it('резерв поздней главы первой страны замедляет движение без ранней остановки', () => {
  const base: PacePlan = { moveSec: 45.7, cruiseMps: 100,
    timeOfIdx: i => i * 45.7 / 99, headAt: t => Math.max(0, Math.min(99, t * 99 / 45.7)) };
  const budget: ReadingBudget = { runs: [{ fromIdx: 0, toIdx: 67 }, { fromIdx: 68, toIdx: 68 }, { fromIdx: 69, toIdx: 99 }],
    last: 99, labelSec: 3.1, firstDelaySec: 0.55 };
  const p = paceWithChapterReading(base, [{ chapter, fromIdx: 56, toIdx: 61 }], 45.7, () => 3.43, budget);
  expect(budget.result?.feasible).toBe(true);
  expect(p.timeOfIdx(61) - p.timeOfIdx(56)).toBeGreaterThanOrEqual(3.53 - 1e-9);
  for (let i = 0; i < 67; i++) expect(p.departureOfIdx!(i)).toBeCloseTo(p.timeOfIdx(i), 9);
});

it('невместимый бюджет явно диагностируется, чтение и порог страны не уменьшаются', () => {
  const base: PacePlan = { moveSec: 10, cruiseMps: 1, timeOfIdx: i => i, headAt: t => t };
  const budget: ReadingBudget = { runs: Array.from({ length: 5 }, (_, i) => ({ fromIdx: i * 2, toIdx: i * 2 + 1 })), last: 9, labelSec: 3.1, firstDelaySec: 0.55 };
  expect(paceWithChapterReading(base, [], 10, () => 4, budget)).toBe(base);
  expect(budget.result?.feasible).toBe(false);
  expect(budget.result!.requiredSec).toBeGreaterThan(15);
});

for (const format of ['9:16', '16:9'] as const) it(`${format}: невместимые страны не отменяют чтение уже помещающихся глав`, () => {
  const route = confirmedWaypointRoute(Array.from({ length: 140 }, (_, i) => jw(40, 20 + i * 0.3, 'overnight', i)));
  const countries = Array.from({ length: 14 }, (_, i): Country => ({ iso2: `C${i}`, nameRu: `Страна ${i}`, nameEn: `Country ${i}` }));
  route.chapters = countries.slice(1, 6).map((c, i) => ({ ...chapter, id: `long-fiction-${i}`,
    text: { ru: 'Вымышленный регион. '.repeat(7), en: 'Fictional region. '.repeat(7) }, anchor: { countries: [c.iso2] } }));
  const env: Enrichment = { ...enrichmentFor(route), countries, countryAt: i => countries[Math.floor(i / 10)],
    beats: [{ kind: 'start', idx: 0 }, { kind: 'finish', idx: 139 }] };
  const tl = buildTimeline(route, env, settings({ format, durationSec: 60 }), timelineOptionsFor(format, 'epic'));
  expect(tl.waypointTiming?.feasible).toBe(false);
  expect(tl.waypointTiming!.requiredSec).toBeGreaterThan(tl.waypointTiming!.availableSec);
  const frames = Array.from({ length: 1800 }, (_, i) => tl.frameAt(i / 30));
  for (const c of route.chapters) {
    const read = Math.max(1.5, (c.title.ru.length + c.text.ru.length) / 28);
    expect(frames.filter(f => f.cards[0]?.chapter?.id === c.id && f.cards[0].alpha === 1).length).toBeGreaterThanOrEqual(Math.floor(read * 30));
  }
});

it('две главы на одной привязке и глава у одиночной метки сохраняют последовательное чтение', () => {
  const base: PacePlan = { moveSec: 45.7, cruiseMps: 100, timeOfIdx: i => i * 5, headAt: t => t / 5 };
  const budget: ReadingBudget = { runs: [{ fromIdx: 0, toIdx: 3 }, { fromIdx: 4, toIdx: 4 }, { fromIdx: 5, toIdx: 8 }], last: 8, labelSec: 3.1, firstDelaySec: 0.55 };
  const matched = [{ chapter, fromIdx: 0, toIdx: 3 }, { chapter: { ...chapter, id: 'second' }, fromIdx: 0, toIdx: 3 },
    { chapter: { ...chapter, id: 'single' }, fromIdx: 4, toIdx: 4 }];
  const p = paceWithChapterReading(base, matched, 45.7, () => 4, budget);
  expect(budget.result?.feasible).toBe(true);
  expect(p.timeOfIdx(3) - p.timeOfIdx(0)).toBeGreaterThanOrEqual(8.75 - 1e-9);
  expect(p.departureOfIdx!(4) - p.timeOfIdx(4)).toBeGreaterThanOrEqual(4.1 - 1e-9);
});

for (const format of ['9:16', '16:9'] as const) it(`${format}: семь стран с разной плотностью, главы, переезды, все 1800 кадров и seek`, () => {
  const lengths = [35, 1, 24, 17, 40, 12, 1];
  const owners = lengths.flatMap((n, i) => Array.from({ length: n }, () => i));
  const route = confirmedWaypointRoute(owners.map((c, i) => jw(40 + c * 0.2, 20 + c * 5 + i * 0.015, 'overnight', i)));
  const countries = lengths.map((_, i): Country => ({ iso2: `C${i}`, nameRu: `Страна ${i}`, nameEn: `Country ${i}` }));
  const env: Enrichment = { ...enrichmentFor(route), countries, countryAt: i => countries[owners[i]],
    countryRuns: lengths.map((_, i) => ({ fromIdx: lengths.slice(0, i).reduce((a, b) => a + b, 0), toIdx: lengths.slice(0, i + 1).reduce((a, b) => a + b, 0) - 1, country: countries[i] })),
    beats: [{ kind: 'start', idx: 0 }, { kind: 'finish', idx: owners.length - 1 }] };
  route.chapters = [0, 2, 4].map(i => ({ ...chapter, id: `fiction-${i}`, anchor: { countries: [`C${i}`] } }));
  const tl = buildTimeline(route, env, settings({ format, durationSec: 60 }), timelineOptionsFor(format, 'epic'));
  expect(tl.waypointTiming?.feasible).toBe(true);
  const fs = Array.from({ length: 1800 }, (_, i) => tl.frameAt(i / 30));
  const start = fs.findIndex((_, k) => k > 0 && k + 30 < fs.length && fs.slice(k, k + 30).every((f, j) => fs[k + j + 1].head - f.head >= 0.02));
  expect(start).toBeGreaterThan(0); expect(start).toBeLessThanOrEqual(180);
  const smooth = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  for (const c of countries) {
    let best = 0, run = 0;
    for (const f of fs) {
      const card = f.cards[0], alpha = card && card.beat.kind !== 'country' ? card.alpha : 0;
      const label = smooth((f.t - 5) / 0.4) * (card?.chapter ? 1 : 1 - smooth(alpha / 0.35));
      run = f.act === 'journey' && f.stats.country === c && label >= 0.5 ? run + 1 : 0; best = Math.max(best, run);
    }
    expect(best, c.iso2).toBeGreaterThanOrEqual(90);
  }
  for (const c of route.chapters) expect(fs.filter(f => f.cards[0]?.chapter?.id === c.id && f.cards[0].alpha === 1).length).toBeGreaterThanOrEqual(45);
  const vp = MAP_VIEWPORT[format], jp = journeyPaddingFor(format), sr = layoutFor(format).safeRect;
  for (let i = 1; i < fs.length; i++) {
    const a = fs[i - 1].camera, f = fs[i], b = f.camera, world = 512 * 2 ** ((a.zoom + b.zoom) / 2);
    expect(Math.hypot((mercX(b.center[0]) - mercX(a.center[0])) * world / vp.width,
      (mercY(b.center[1]) - mercY(a.center[1])) * world / vp.height), `center ${i}`).toBeLessThanOrEqual(0.01);
    expect(Math.abs(b.zoom - a.zoom) * 30).toBeLessThanOrEqual(0.600001);
    if (f.act !== 'journey') continue;
    const w = 512 * 2 ** b.zoom, p = Math.min(28, b.pitchDegrees ?? b.pitch * 64) * Math.PI / 180;
    const dx = (mercX(f.headLonLat[0]) - mercX(b.center[0])) * w, dy = (mercY(f.headLonLat[1]) - mercY(b.center[1])) * w;
    const k = 1.5 * vp.height / (1.5 * vp.height - dy * Math.sin(p));
    const x = vp.width / 2 + dx * k, y = vp.height / 2 + dy * Math.cos(p) * k;
    expect(x, `head x ${i}`).toBeGreaterThanOrEqual(Math.max(jp.left, sr.x / 2));
    expect(x, `head x ${i}`).toBeLessThanOrEqual(Math.min(vp.width - jp.right, (sr.x + sr.w) / 2));
    expect(y, `head y ${i}`).toBeGreaterThanOrEqual(Math.max(jp.top, sr.y / 2));
    expect(y, `head y ${i}`).toBeLessThanOrEqual(Math.min(vp.height - jp.bottom, (sr.y + sr.h) / 2));
  }
  for (let i = fs.length - 1; i >= 0; i -= 11) expect(tl.frameAt(i / 30)).toEqual(fs[i]);
  // Inter-frame sampling catches violations that a 30 Hz raster can miss.
  let previous = tl.frameAt(0).camera;
  for (let i = 1; i <= 60 * 120; i++) {
    const next = tl.frameAt(i / 120).camera, world = 512 * 2 ** Math.max(previous.zoom, next.zoom);
    expect(Math.hypot((mercX(next.center[0]) - mercX(previous.center[0])) * world / vp.width,
      (mercY(next.center[1]) - mercY(previous.center[1])) * world / vp.height)).toBeLessThanOrEqual(0.01 / 4);
    expect(Math.abs(next.zoom - previous.zoom) * 120).toBeLessThanOrEqual(0.600001);
    previous = next;
  }
  for (const t of [5.73, 18.123, 44.717, 53.981]) { const f = tl.frameAt(t); tl.frameAt(60); tl.frameAt(0); expect(tl.frameAt(t)).toEqual(f); }
});

import { expect, it } from 'vitest';
import { cameraCubic, chapterCameraWeight, journeyCamera, overviewCamera, planChapterCamera, planWaypointCenter, planWaypointZoom } from '../../src/story/camera';
import { paceWithChapterReading } from '../../src/story/chapters';
import { journeyFacts, waypointPacingRoute } from '../../src/story/legs';
import { buildTimeline } from '../../src/story/timeline';
import type { PacePlan } from '../../src/story/pace';
import { timelineOptionsFor } from '../../src/render/layout';
import { MAP_VIEWPORT, type Chapter, type Country } from '../../src/types';
import { enrichmentFor, settings } from './fixtures';
import { confirmedWaypointRoute, D0, DAY, jw, sevenChapterRoute } from './waypoint-fixtures';
import { mercX, mercY } from '../../src/story/mercator';

const chapter: Chapter = { id: 'synthetic', title: { ru: 'Глава', en: 'Chapter' },
  text: { ru: 'Вымышленный регион.', en: 'A fictional region.' }, source: 'traveler', mood: 'rain',
  anchor: { countries: ['GE'] } };
const route = () => confirmedWaypointRoute(Array.from({ length: 100 }, (_, i) => jw(40, 20 + i * 0.7, 'overnight', i)));

it('пересекающиеся разгоны объединены без возврата к базе; seek плавный и детерминированный', () => {
  const marks = route();
  const pacing = waypointPacingRoute(marks, journeyFacts(marks)!);
  const camera = journeyCamera({ route: pacing, viewport: MAP_VIEWPORT['9:16'], journeySec: 40,
    baseZoom: 4.2, chapterZoom: 6.2, chapterWindows: [{ start: 8, end: 12 }, { start: 22, end: 27 }],
    headIdxAt: t => t / 40 * 99, beatTimes: [] });
  const frames = Array.from({ length: 2401 }, (_, i) => camera.at(i / 60));
  for (const [start, end] of [[8, 12], [22, 27]]) {
    for (let i = start * 60; i <= end * 60; i++) expect(frames[i].zoom).toBeGreaterThanOrEqual(4.2 + 1.5);
  }
  expect(camera.at(18).zoom).toBeCloseTo(6.2, 8);
  expect(camera.chapterWindows).toHaveLength(1);
  expect(Math.max(...frames.slice(1).map((f, i) => Math.abs(f.zoom - frames[i].zoom)))).toBeLessThanOrEqual(0.600001 / 60);
  for (let i = frames.length - 1; i >= 0; i -= 7) expect(camera.at(i / 60)).toEqual(frames[i]);
});

for (const format of ['9:16', '16:9'] as const) {
  it(`${format}: главы подключены к камере, движение не позже 6 с, итог и предел зума сохранены`, () => {
    const marks = route();
    marks.chapters = [8, 32, 59].map((from, i) => ({ ...chapter, id: `synthetic-${i}`,
      anchor: { countries: ['GE'], markedAt: { from: D0 + from * DAY, to: D0 + (from + 8) * DAY } } }));
    const env = enrichmentFor(marks, { border: 100 });
    const opts = timelineOptionsFor(format, 'epic');
    const timeline = buildTimeline(marks, env, settings({ format, durationSec: 60 }), opts);
    const frames = Array.from({ length: 1801 }, (_, i) => timeline.frameAt(i / 30));
    const overview = overviewCamera(marks, MAP_VIEWPORT[format], opts.overviewPadding).zoom;
    const start = frames.findIndex((_, k) => k > 0 && k + 30 < frames.length
      && frames.slice(k, k + 30).every((f, j) => frames[k + j + 1].head - f.head >= 0.02));
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThanOrEqual(180);
    expect(new Set(frames.flatMap(f => f.cards.flatMap(c => c.chapter ? [c.chapter.id] : []))).size).toBe(3);
    for (const f of frames.filter(f => f.cards.some(c => c.chapter))) expect(f.camera.zoom).toBeGreaterThanOrEqual(overview + 1.5);
    expect(Math.max(...frames.slice(1).map((f, i) => Math.abs(f.camera.zoom - frames[i].camera.zoom)))).toBeLessThanOrEqual(0.02000004);
    expect(frames.every(f => f.camera.zoom <= 8)).toBe(true);
    expect(frames.every((f, i) => i === 0 || f.head >= frames[i - 1].head)).toBe(true);
    expect(timeline.frameAt(60).showFinish).toBe(true);
    expect(marks.totalM).toBe(0);
    expect(marks.hasTime).toBe(false);
    expect(timeline.frameAt(60).camera.zoom).toBe(overview);
  });
}

it('даже плотные главы сохраняют участкам без главы >=30% исходного времени, полное чтение и обратное отображение', () => {
  const base: PacePlan = { moveSec: 40, cruiseMps: 100, timeOfIdx: i => i, headAt: t => Math.max(0, Math.min(40, t)) };
  const matched = Array.from({ length: 6 }, (_, i) => ({ chapter: { ...chapter, id: `c${i}` }, fromIdx: 10 + i * 2, toIdx: 11 + i * 2 }));
  const pace = paceWithChapterReading(base, matched, 40, () => 4);
  const gaps = [[0, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 40]];
  for (const [a, b] of gaps) expect(pace.timeOfIdx(b) - pace.timeOfIdx(a)).toBeGreaterThanOrEqual((b - a) * 0.3 - 1e-10);
  for (const m of matched) expect(pace.timeOfIdx(m.toIdx) - pace.timeOfIdx(m.fromIdx)).toBeGreaterThanOrEqual(4.1 - 1e-10);
  for (let i = 0; i <= 40; i += 0.25) expect(pace.headAt(pace.timeOfIdx(i))).toBeCloseTo(i, 8);
  expect(pace.timeOfIdx(40)).toBeCloseTo(40, 8);
});

it('кубические окна: короткие, соседние, крайние; амплитуда уступает месту, чтение сохраняется', () => {
  const cards = [{ start: 0.4, end: 1.1 }, { start: 1.2, end: 2.2 }, { start: 8.5, end: 9.6 }];
  const original = JSON.stringify(cards);
  const groups = planChapterCamera(cards, 0, 10, 4, 6);
  expect(JSON.stringify(cards)).toBe(original);
  expect(groups).toHaveLength(1);
  expect(groups[0].amplitude).toBeLessThan(2);
  for (const w of groups) {
    expect(w.start).toBeGreaterThanOrEqual(-1e-10);
    expect(w.end).toBeLessThanOrEqual(10 + 1e-10);
    expect(chapterCameraWeight(w.plateauStart, w)).toBe(1);
    expect(chapterCameraWeight(w.plateauEnd, w)).toBe(1);
    const r = w.plateauStart - w.start;
    expect(1.5 * w.amplitude / r).toBeLessThanOrEqual(0.600001);
  }
  expect(planChapterCamera([{ start: 10, end: 12 }, { start: 30, end: 32 }], 0, 45, 4, 6)).toHaveLength(2);
});

it('ограничение всего зума: выбросы и скачки, C1, концы, произвольный и обратный seek', () => {
  const z = planWaypointZoom(t => t < 5 ? 16 : t < 10 ? 4 : 8 + 3 * Math.sin(t * 5), 20, 17, 4, 8);
  const times = Array.from({ length: 1201 }, (_, i) => i / 60);
  const values = times.map(z);
  for (let i = 1; i < times.length; i++) expect(Math.abs(values[i] - values[i - 1])).toBeLessThanOrEqual(0.600001 / 60);
  for (let i = times.length - 1; i >= 0; i--) expect(z(times[i])).toBe(values[i]);
  expect(z(0)).toBe(4); expect(z(17)).toBeCloseTo(4, 10); expect(z(20)).toBeCloseTo(4, 10);
  for (const t of [...times, 5.00123, 10.00875, 16.75111]) {
    const e = 1e-4, l = (z(t) - z(t - e)) / e, r = (z(t + e) - z(t)) / e;
    expect(Math.abs(l)).toBeLessThanOrEqual(0.600001);
    expect(Math.abs(r)).toBeLessThanOrEqual(0.600001);
    expect(Math.abs(l - r)).toBeLessThan(0.00025);
  }
});

it('минимум чтения начинает наезд заранее, выдерживает фильтры и ограничения скорости', () => {
  const plateau = { start: 5.84, end: 9.13, zoom: 4.107 };
  const z = planWaypointZoom(() => 2.607, 60, 54, 2.607, 8, [plateau]);
  expect(z(3)).toBeGreaterThan(2.607);
  for (let i = 1; i <= 60000; i++) {
    const t = i / 1000;
    expect(Math.abs(z(t) - z(t - 0.001)) * 1000).toBeLessThanOrEqual(0.600001);
    if (t >= plateau.start && t <= plateau.end) expect(z(t)).toBeGreaterThanOrEqual(plateau.zoom - 1e-10);
  }
  expect(z(0)).toBe(2.607);
  expect(z(54)).toBeCloseTo(2.607, 10);
});

it('16:9: быстрый переезд сокращает плато чтения, сохраняя крупный план, safe area, скорость и C1', () => {
  const viewport = MAP_VIEWPORT['16:9'];
  const overview = { x: 0.5, y: 0.5, zoom: 2, pitch: 0 };
  const headAt = (t: number): [number, number] => [0.5, 0.5 + 0.06 * cameraCubic((t - 10) / 0.6)];
  const camera = planWaypointCenter(t => ({ ...overview, y: headAt(t)[1] }), headAt,
    20, 5, 18, viewport, undefined, 28, overview, t => t >= 6 && t <= 14, [{ start: 6, end: 14 }]);
  const frames = Array.from({ length: 1201 }, (_, i) => camera(i / 60));
  const reading = frames.filter((_, i) => i / 60 > 6 && i / 60 < 14);
  expect(Math.max(...reading.map(c => c.zoom))).toBeGreaterThanOrEqual(overview.zoom + 1.5);
  // Full-card close-up is infeasible here: the camera must widen for the transfer.
  expect(camera(10.3).zoom).toBeLessThan(overview.zoom + 1.5);
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i], world = 512 * 2 ** Math.max(a.zoom, b.zoom);
    expect(Math.abs(b.zoom - a.zoom) * 60).toBeLessThanOrEqual(0.600001);
    expect(Math.hypot((b.x - a.x) / viewport.width, (b.y - a.y) / viewport.height) * world / 2).toBeLessThanOrEqual(0.01);
    if (i < 300 || i >= 1080) continue;
    const head = headAt(i / 60), scale = 512 * 2 ** b.zoom;
    const x = viewport.width / 2 + (head[0] - b.x) * scale;
    const y = viewport.height / 2 + (head[1] - b.y) * scale;
    expect(x).toBeGreaterThanOrEqual(viewport.width * 0.04);
    expect(x).toBeLessThanOrEqual(viewport.width * 0.96);
    expect(y).toBeGreaterThanOrEqual(viewport.height * 0.05);
    expect(y).toBeLessThanOrEqual(viewport.height * 0.935);
    if (i / 60 >= 6 && i / 60 <= 14) {
      expect(x).toBeLessThanOrEqual(viewport.width * 0.6);
      expect(y).toBeGreaterThanOrEqual(viewport.height * 0.55);
    }
  }
  for (const t of [0, 5, 6, 10, 10.6, 14, 18, 20]) {
    const e = 1e-4, a = camera(t - e), b = camera(t), c = camera(t + e);
    expect(Math.abs(c.zoom - 2 * b.zoom + a.zoom) / e).toBeLessThan(0.001);
    expect(Math.hypot(c.x - 2 * b.x + a.x, c.y - 2 * b.y + a.y) * 512 * 2 ** b.zoom / e).toBeLessThan(0.2);
  }
  for (let i = frames.length - 1; i >= 0; i -= 17) expect(camera(i / 60)).toEqual(frames[i]);
});

it('16:9: несовместимый переезд не снижает пики и не сокращает чтение соседних совместимых глав', () => {
  const viewport = MAP_VIEWPORT['16:9'];
  const overview = { x: 0.5, y: 0.5, zoom: 2, pitch: 0 };
  const headAt = (t: number): [number, number] => [0.5, 0.5 + 0.06 * cameraCubic((t - 20) / 0.6)];
  const windows = [{ start: 8, end: 12 }, { start: 16, end: 24 }, { start: 29, end: 33 }];
  const camera = planWaypointCenter(t => ({ ...overview, zoom: 5, y: headAt(t)[1] }), headAt,
    40, 5, 38, viewport, undefined, 28, overview,
    t => windows.some(w => t >= w.start - 1 && t <= w.end + 0.5), windows);
  for (const w of [windows[0], windows[2]]) {
    for (let t = w.start; t <= w.end; t += 1 / 60) expect(camera(t).zoom).toBeGreaterThanOrEqual(3.5);
    expect(camera((w.start + w.end) / 2).zoom).toBeCloseTo(5, 8);
  }
  expect(camera(20.3).zoom).toBeLessThan(3.5);
  for (let i = 1; i <= 2400; i++) {
    const a = camera((i - 1) / 60), b = camera(i / 60);
    expect(Math.abs(b.zoom - a.zoom) * 60).toBeLessThanOrEqual(0.600001);
    expect(Math.hypot((b.x - a.x) / viewport.width, (b.y - a.y) / viewport.height)
      * 512 * 2 ** Math.max(a.zoom, b.zoom)).toBeLessThanOrEqual(0.285 / 60 + 1e-6);
  }
});

for (const format of ['9:16', '16:9'] as const) {
  it(`${format}: несколько соседних глав после префикса, крупный план на всём чтении`, () => {
    // Only the numeric import shape is retained: all positions, names and prose are fictional.
    const lengths = [68, 1, 1, 14, 19, 20, 18, 50, 15, 8];
    const owners = lengths.flatMap((n, i) => Array.from({ length: n }, () => i));
    const marks = confirmedWaypointRoute(owners.map((_, i) => jw(40, 20 + i * 0.35, 'overnight', i)));
    const countries = lengths.map((_, i): Country => ({ iso2: `C${i}`, nameRu: `Страна ${i}`, nameEn: `Country ${i}` }));
    const env = { ...enrichmentFor(marks), countries, countryAt: (i: number) => countries[owners[i]],
      countryRuns: lengths.map((_, i) => ({ fromIdx: owners.indexOf(i), toIdx: owners.lastIndexOf(i), country: countries[i] })),
      beats: [{ kind: 'start' as const, idx: 0 }, { kind: 'finish' as const, idx: owners.length - 1 }] };
    marks.chapters = [[56, 61, 75], [84, 102, 133], [103, 122, 122], [123, 140, 83], [123, 140, 142], [141, 156, 84]]
      .map(([from, to, chars], i) => ({ ...chapter, id: `shape-${i}`,
        text: { ru: 'Я'.repeat(chars - chapter.title.ru.length), en: 'Fictional region.' },
        anchor: { countries: [countries[owners[from]].iso2], markedAt: { from: D0 + from * DAY, to: D0 + to * DAY } } }));
    const opts = timelineOptionsFor(format, 'epic');
    const tl = buildTimeline(marks, env, settings({ format, durationSec: 60 }), opts);
    const overview = overviewCamera(marks, MAP_VIEWPORT[format], opts.overviewPadding).zoom;
    const fs = Array.from({ length: 3601 }, (_, i) => tl.frameAt(i / 60));
    for (const c of marks.chapters) {
      const shown = fs.filter(f => f.cards[0]?.chapter?.id === c.id);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.filter(f => f.cards[0].alpha === 1).length / 60).toBeGreaterThanOrEqual((c.title.ru.length + c.text.ru.length) / 28 - 1 / 60);
      for (const f of shown) expect(f.camera.zoom).toBeGreaterThanOrEqual(overview + 1.5);
    }
    const plan = tl.waypointCameraPlan!;
    const seams = [0, 5, 54, 60, plan.diveFrom, plan.diveTo, plan.pullFrom, plan.pullTo,
      ...plan.windows.flatMap(w => [w.start, w.plateauStart, w.plateauEnd, w.end])];
    for (const t of seams.filter(t => t >= 0 && t <= 60)) {
      const e = 1e-4, a = tl.frameAt(t - e).camera, b = tl.frameAt(t).camera, c = tl.frameAt(t + e).camera;
      expect(Math.abs((b.zoom - a.zoom) / e - (c.zoom - b.zoom) / e)).toBeLessThan(0.001);
      expect(Math.hypot(mercX(c.center[0]) - 2 * mercX(b.center[0]) + mercX(a.center[0]),
        mercY(c.center[1]) - 2 * mercY(b.center[1]) + mercY(a.center[1])) * 512 * 2 ** b.zoom / e).toBeLessThan(0.2);
    }
    for (let i = 1; i < fs.length; i++) expect(Math.abs(fs[i].camera.zoom - fs[i - 1].camera.zoom) * 60).toBeLessThanOrEqual(0.600001);
    for (let i = fs.length - 1; i >= 0; i -= 17) expect(tl.frameAt(i / 60)).toEqual(fs[i]);
  });
}

for (const format of ['9:16', '16:9'] as const) {
  it(`${format}: семь глав, бит и переезд; весь ролик <=0.6, C1 зума и центра на стыках`, () => {
    const marks = sevenChapterRoute();
    const timeline = buildTimeline(marks, enrichmentFor(marks, { border: 100, extraBeats: [{ kind: 'country', idx: 48 }] }),
      settings({ format, durationSec: 60 }), timelineOptionsFor(format, 'epic'));
    const fs = Array.from({ length: 3601 }, (_, i) => timeline.frameAt(i / 60));
    expect(new Set(fs.flatMap(f => f.cards.flatMap(c => c.chapter ? [c.chapter.id] : []))).size).toBe(7);
    let prev = [0, 0];
    for (let i = 1; i < fs.length; i++) {
      expect(Math.abs(fs[i].camera.zoom - fs[i - 1].camera.zoom)).toBeLessThanOrEqual(0.600001 / 60);
      const a = fs[i - 1].camera, b = fs[i].camera, world = 512 * 2 ** Math.max(a.zoom, b.zoom);
      const step = [(mercX(b.center[0]) - mercX(a.center[0])) * world, (mercY(b.center[1]) - mercY(a.center[1])) * world];
      expect(Math.hypot(...step)).toBeLessThan(40 / 2);
      expect(Math.hypot(step[0] - prev[0], step[1] - prev[1])).toBeLessThan(2);
      prev = step;
    }
    const plan = timeline.waypointCameraPlan!;
    const seams = [0, 5, plan.diveTo, 54, 60, plan.diveFrom, plan.diveTo, plan.pullFrom, plan.pullTo,
      ...plan.windows.flatMap(w => [w.start, w.plateauStart, w.plateauEnd, w.end])];
    for (const t of seams.filter(t => t >= 0 && t <= 60)) {
      const e = 1e-4, a = timeline.frameAt(t - e).camera, b = timeline.frameAt(t).camera, c = timeline.frameAt(t + e).camera;
      expect(Math.abs((b.zoom - a.zoom) / e - (c.zoom - b.zoom) / e)).toBeLessThan(0.001);
      const world = 512 * 2 ** b.zoom;
      const deltaV = Math.hypot(mercX(c.center[0]) - 2 * mercX(b.center[0]) + mercX(a.center[0]),
        mercY(c.center[1]) - 2 * mercY(b.center[1]) + mercY(a.center[1])) * world / e;
      expect(deltaV).toBeLessThan(0.2);
    }
    for (let i = fs.length - 1; i >= 0; i -= 13) expect(timeline.frameAt(i / 60)).toEqual(fs[i]);
    for (const t of [9.12345, 21.81234, 50.77661]) {
      const f = timeline.frameAt(t); timeline.frameAt(60); timeline.frameAt(0); expect(timeline.frameAt(t)).toEqual(f);
    }
  });
}

it('компактный маршрут по меткам не превышает зум 8 даже на обычных битах и в обзоре без подтверждения', () => {
  const marks = confirmedWaypointRoute(Array.from({ length: 12 }, (_, i) => jw(40, 30 + i * 0.0001, 'overnight', i)));
  for (const confirmed of [false, true]) {
    const timeline = buildTimeline({ ...marks, waypointOrderConfirmed: confirmed }, enrichmentFor(marks), settings({ durationSec: 60 }), timelineOptionsFor('9:16', 'epic'));
    for (let i = 0; i <= 1800; i++) expect(timeline.frameAt(i / 30).camera.zoom).toBeLessThanOrEqual(8);
  }
});

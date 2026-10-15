import { expect, it, vi } from 'vitest';
import { STYLES } from '../../src/render/styles';
import * as callouts from '../../src/render/callouts';
import { CALLOUT_MAX_HEAD_DISTANCE, planHeldCallouts, calloutAnchorAlpha, calloutChangeWindows, calloutLeaderAlpha, drawCinematicGeography, placeJourneyCallout, type CalloutSweep } from '../../src/render/cinematic';
import type { Chapter, FrameState } from '../../src/types';
import { layoutFor, timelineOptionsFor, type Rect } from '../../src/render/layout';
import { overlayTitleBottom } from '../../src/render/overlay';
import { prepareTrack } from '../../src/render/track';
import { buildTimeline } from '../../src/story';
import { enrichmentFor, lineRoute, settings } from '../story/fixtures';
import { confirmedWaypointRoute, jw } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';
import { waypointLineIntersects } from '../../src/render/waypoint-layer';

it('план выноски гаснет до границы страны и не выбирает соседнюю страну даже рядом с головой', () => {
  const route = confirmedWaypointRoute([jw(40, 30, 'overnight', 0), jw(41, 31, 'overnight', 1)]);
  const enrichment = enrichmentFor(route, { border: 1 }), cfg = settings({ durationSec: 60 });
  const timeline = buildTimeline(route, enrichment, cfg, timelineOptionsFor(cfg.format));
  const frames = Array.from({ length: 1801 }, (_, i) => {
    const f = timeline.frameAt(i / 30), head = i < 900 ? 0 : 1;
    return { ...f, head, cards: [], stats: { ...f.stats, country: enrichment.countryAt(head) } };
  });
  const sweep: CalloutSweep = {
    heads: frames.filter(f => f.act === 'journey').map(() => ({ x: 500, y: 800 })),
    candidates: { frames, points: frames.map(() => [{ x: 520, y: 800 }, { x: 510, y: 800 }]) },
  };
  const holds = planHeldCallouts(sweep, { x: 64, y: 500, w: 400, h: 90 }, 48,
    { x: 0, y: 0, w: 1080, h: 1920 }, ['GE', 'AM']);
  expect(holds.map(h => h.index)).toEqual([0, 1]);
  for (const hold of holds) for (let i = hold.start; i < hold.end; i++) {
    expect(['GE', 'AM'][hold.index]).toBe(frames[i].stats.country?.iso2);
  }
  expect(holds[0].end).toBeLessThanOrEqual(900);
  expect(holds[1].start).toBeGreaterThanOrEqual(900);
});

it.each(['9:16', '16:9'] as const)('%s: DEM-легенда обходит весь путь головы, включая будущий кадр', format => {
  const route = confirmedWaypointRoute([jw(40, 30, 'overnight', 0), jw(41, 31, 'overnight', 1)]);
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 });
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format)).frameAt(20);
  const rec = recorder(), l = layoutFor(format), style = STYLES.epic;
  const head = { x: l.work.x + 180, y: l.caption.y + l.caption.h + 56 };
  const sweep: CalloutSweep = { heads: [head] };
  rec.ctx.fillRect = (x, y, w, h) => rec.fills.push({ x, y, w, h, alpha: rec.ctx.globalAlpha });
  drawCinematicGeography(rec.ctx, frame, route, enrichment, cfg, style,
    () => ({ x: 250, y: 400 }), prepareTrack(route), true, false, 1, () => sweep);
  const legend = rec.fills[0];
  const gap = Math.hypot(Math.max(legend.x - head.x, 0, head.x - legend.x - legend.w),
    Math.max(legend.y - head.y, 0, head.y - legend.y - legend.h));
  expect(gap - (style.marker.radius + style.marker.ringGap + style.marker.ringWidth + 2.2)).toBeGreaterThanOrEqual(35);
});

it.each(['9:16', '16:9'] as const)('%s: плотные метки пропускаются; семь глав видны >= 3 с, выдержка карточки >= 2,5 с', format => {
  const route = confirmedWaypointRoute(Array.from({ length: 200 }, (_, i) => jw(40, 30 + i * 0.01, 'overnight', i)));
  const cfg = settings({ format, durationSec: 60 }), enrichment = enrichmentFor(route), style = STYLES.epic;
  const timeline = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id));
  const chapters: Chapter[] = Array.from({ length: 7 }, (_, i) => ({
    id: `fiction-${i}`, title: { ru: 'Глава', en: 'Chapter' }, text: { ru: 'Синтетика.', en: 'Synthetic.' },
    anchor: { countries: ['GE'] }, mood: 'neutral', source: 'traveler', ...(i === 6 ? { finale: true } : {}),
  }));
  route.chapters = chapters;
  // Include a 3.27 s chapter and adjacent chapters: fading every crossed point cannot pass.
  const windows = [[329, 427], [530, 690], [714, 863], [901, 1008], [1012, 1183], [1267, 1375]];
  const frames: FrameState[] = Array.from({ length: 1801 }, (_, i) => {
    const frame = timeline.frameAt(i / 30), chapter = windows.findIndex(([start, end]) => i >= start && i < end);
    return { ...frame, cards: frame.act === 'journey' && chapter >= 0 ?
      [{ chapter: chapters[chapter], beat: { kind: 'waypoint', idx: Math.floor(frame.head) }, alpha: 1, enter: 1 }] : [],
    ...(frame.act === 'outro' ? { finalChapter: chapters[6] } : {}) };
  });
  const l = layoutFor(format), model = prepareTrack(route);
  const projectAt = (i: number, lon: number) => {
    const frame = frames[i], progress = Math.max(0, Math.min(1, (frame.t - 5) / 49));
    const index = Math.round((lon - 30) / 0.01);
    // Every eleventh point repeatedly disappears: it never offers a readable hold.
    const unsafe = frame.act === 'journey' && index % 11 === 0 && Math.floor(frame.t) % 2 === 0;
    return { x: unsafe ? -100 : l.width * (0.5 + ((lon - 30) / 1.99 - progress) * 6) / 2,
      y: l.height * 0.6 / 2 };
  };
  const candidates = frames.map((_f, i) => route.points.map(p => {
    const a = projectAt(i, p.lon); return { x: a.x * 2, y: a.y * 2 };
  }));
  // Match the moving route's screen head; candidate proximity is now part of booking.
  const head = { x: l.width * 0.5, y: l.height * 0.6 };
  const sweep: CalloutSweep = { heads: frames.filter(f => f.act === 'journey').map(() => head),
    candidates: { frames, points: candidates }, changes: calloutChangeWindows([5, 54]) };
  model.sx[model.n] = head.x / 2; model.sy[model.n] = head.y / 2; model.have[model.n] = 1;
  const place = vi.spyOn(callouts, 'placeCallout').mockReturnValue({ x: 80, y: 300, w: 400, h: l.readability.calloutHeight });
  const sample = (i: number) => {
    const r = recorder();
    r.ctx.fillRect = (x, y, w, h) => r.fills.push({ x, y, w, h, alpha: r.ctx.globalAlpha });
    drawCinematicGeography(r.ctx, frames[i], route, enrichment, cfg, style,
      lon => projectAt(i, lon), model, false, false, 1, () => sweep);
    const card = r.fills.find(r => r.h === l.readability.calloutHeight)!;
    expect(card).toBeDefined();
    return { alpha: card.alpha, content: r.texts.slice(-3), leader: r.strokes[0].segments[0] };
  };
  try {
    const holds = planHeldCallouts(sweep, { x: 80, y: 300, w: 400, h: l.readability.calloutHeight },
      48, { x: 0, y: 0, w: l.width, h: l.height });
    expect(holds.length).toBeGreaterThan(4);
    for (const hold of holds) for (let i = hold.start + 6; i < hold.end - 6; i++) {
      const anchor = candidates[i][hold.index];
      expect(Math.hypot(anchor.x - head.x, anchor.y - head.y), `stale anchor at ${i / 30}s`)
        .toBeLessThanOrEqual(CALLOUT_MAX_HEAD_DISTANCE);
    }
    const rows = frames.map((_f, i) => sample(i));
    for (const chapter of chapters) {
      let run = 0, longest = 0;
      for (let i = 0; i < rows.length; i++) {
        const shown = frames[i].cards.some(c => c.chapter?.id === chapter.id) || frames[i].finalChapter?.id === chapter.id;
        run = shown && rows[i].alpha === 1 ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
      expect(longest / 30, chapter.id).toBeGreaterThanOrEqual(3);
    }
    let fullRun = 0, hiddenRun = 0, switches = 0;
    for (let i = 150; i < 1620; i++) {
      const a = rows[i], b = rows[i - 1];
      if (a.alpha === 1) fullRun++;
      else if (fullRun) { expect(fullRun / 30).toBeGreaterThanOrEqual(2.5); fullRun = 0; }
      hiddenRun = a.alpha === 0 ? hiddenRun + 1 : 0;
      expect(hiddenRun / 30).toBeLessThanOrEqual(3);
      if (JSON.stringify(a.content) !== JSON.stringify(b.content)) {
        switches++; expect(a.alpha).toBe(0); expect(b.alpha).toBe(0);
      }
      if (a.alpha > 0 && b.alpha > 0) for (const end of ['from', 'to'] as const) {
        expect(Math.hypot(a.leader[end][0] - b.leader[end][0], a.leader[end][1] - b.leader[end][1])).toBeLessThanOrEqual(25);
      }
    }
    if (fullRun) expect(fullRun / 30).toBeGreaterThanOrEqual(2.5);
    expect(switches).toBeGreaterThan(4);
    expect(switches).toBeLessThan(15);
    expect(rows.slice(150, 1620).filter(r => r.alpha === 1).length / 1470).toBeGreaterThanOrEqual(0.6);
    for (const i of [1600, 630, 180, 1050, 360]) expect(sample(i)).toEqual(rows[i]);
  } finally { place.mockRestore(); }
});

it.each(['9:16', '16:9'] as const)('%s: смена якоря, текста и номера плана происходит только при нулевой alpha', format => {
  const route = confirmedWaypointRoute(Array.from({ length: 12 }, (_, i) => jw(41 + i * 0.1, 29 + i, 'overnight', i)));
  const cfg = settings({ format, durationSec: 60 }), enrichment = enrichmentFor(route), style = STYLES.epic;
  const timeline = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id));
  const frames = Array.from({ length: timeline.frameCount + 1 }, (_, i) => timeline.frameAt(i / 30));
  const index = (f: typeof frames[number]) => f.act === 'intro' ? 0 : f.act === 'outro' ? route.points.length - 1 : Math.floor(f.head);
  const key = (f: typeof frames[number]) => `${index(f)}:${f.act}:${f.shot?.number}`;
  const changes = frames.flatMap((f, i) => i && key(f) !== key(frames[i - 1]) ? [i / 30] : []);
  const sweep = { heads: [], changes: calloutChangeWindows(changes) };
  const l = layoutFor(format), model = prepareTrack(route);
  // Isolate transition opacity from the already-covered obstacle search in intro/outro.
  const placement = vi.spyOn(callouts, 'placeCallout').mockReturnValue({ x: 80, y: 700, w: 600, h: l.readability.calloutHeight });
  try {
    const sample = (i: number) => {
      const rec = recorder();
      rec.ctx.fillRect = (x, y, w, h) => { rec.fills.push({ x, y, w, h, alpha: rec.ctx.globalAlpha }); };
      drawCinematicGeography(rec.ctx, frames[i], route, enrichment, cfg, style,
        lon => ({ x: l.width * (lon < 34 ? 0.25 : 0.75) / 2, y: l.height * 0.45 / 2 }),
        model, false, false, 1, () => sweep);
      const card = rec.fills.find(r => r.h === l.readability.calloutHeight);
      expect(card).toBeDefined();
      return { alpha: card!.alpha, texts: rec.texts.slice(-3), leader: rec.strokes[0].segments[0] };
    };
    const rows = frames.map((_f, i) => sample(i));
    let switches = 0;
    for (let i = 1; i < rows.length; i++) {
      if (key(frames[i]) !== key(frames[i - 1])) {
        switches++;
        expect(rows[i - 1].alpha).toBe(0);
        expect(rows[i].alpha).toBe(0);
        // The continuous timeline can switch between the two sampled frames too.
        const viewport = { x: 0, y: 0, w: l.width, h: l.height }, point = { x: l.width / 2, y: l.height / 2 };
        for (let step = 0; step <= 10; step++) {
          expect(calloutAnchorAlpha(point, viewport, (i - 1 + step / 10) / 30, sweep)).toBe(0);
        }
      }
      if (rows[i].alpha > 0 && rows[i - 1].alpha > 0) expect(rows[i].texts).toEqual(rows[i - 1].texts);
      // The independent act envelope can multiply the transition fade at intro/outro.
      expect(Math.abs(rows[i].alpha - rows[i - 1].alpha)).toBeLessThanOrEqual(0.25);
    }
    expect(switches).toBeGreaterThan(10);
    // No isolated hidden/visible runs of one or two frames, including act layout changes.
    for (let i = 1; i < rows.length - 2; i++) {
      for (const hidden of [true, false]) {
        const matches = (j: number) => (rows[j].alpha === 0) === hidden;
        if (!matches(i - 1) && matches(i)) {
          expect(matches(i + 1) && matches(i + 2)).toBe(true);
        }
      }
    }
    for (const i of [1700, 839, 20, 1382, 300, 900]) expect(sample(i)).toEqual(rows[i]);
  } finally { placement.mockRestore(); }
});

it('частые смены объединяются без коротких вспышек, одиночная смена получает плавный fade и паузу', () => {
  const changes = calloutChangeWindows([2, 2.25, 2.5, 4]);
  expect(changes).toHaveLength(2);
  const viewport = { x: 0, y: 0, w: 1920, h: 1080 }, point = { x: 960, y: 540 };
  const alpha = (t: number) => calloutAnchorAlpha(point, viewport, t, { heads: [], changes });
  expect(alpha(1.4)).toBe(1);
  expect(alpha(1.7)).toBeGreaterThan(0);
  for (let i = 57; i <= 78; i++) expect(alpha(i / 30)).toBe(0);
  expect(alpha(2.8)).toBeCloseTo(0.5);
  expect(alpha(3.1)).toBe(1);
  expect(alpha(4 - 1 / 30)).toBe(0);
  expect(alpha(4)).toBe(0);
  expect(alpha(4.3)).toBeCloseTo(0.5);
  expect(alpha(4.6)).toBe(1);
});

it('конец соединителя меняет обрезку у головы только внутри плавного гашения', () => {
  const box = { x: 600, y: 200, w: 200, h: 90 };
  const anchors = Array.from({ length: 121 }, () => ({ x: 300, y: 600 }));
  const heads = anchors.map((_p, i) => ({ x: i < 60 ? 450 : 800, y: 445 }));
  const sweep = { heads, anchors };
  const alpha = (i: number) => calloutLeaderAlpha(sweep, box, 48, 0, i / 30);
  expect(alpha(42)).toBe(1);
  expect(alpha(52)).toBeGreaterThan(0);
  expect(alpha(52)).toBeLessThan(1);
  for (let i = 57; i <= 63; i++) expect(alpha(i)).toBe(0);
  expect(alpha(72)).toBeGreaterThan(0);
  expect(alpha(78)).toBe(1);
  for (const i of [72, 59, 60, 42]) {
    expect(calloutLeaderAlpha({ ...sweep }, box, 48, 0, i / 30)).toBe(alpha(i));
  }
});

it.each(['9:16', '16:9'] as const)('%s: один слот на всём интервале, без одиночных пропусков и зависимости от порядка кадров', format => {
  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
  const timeline = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id));
  const layout = layoutFor(format), radius = style.marker.radius + style.marker.ringGap + style.marker.ringWidth + 2.2;
  const heads = Array.from({ length: 1470 }, (_, i) => ({
    x: layout.work.x + layout.work.w * (0.4 + 0.15 * Math.sin(i / 90)),
    y: format === '9:16' ? 820 + 50 * Math.sin(i / 120) : 600 + 40 * Math.sin(i / 120),
  }));
  const sweep = { heads }, model = prepareTrack(route), positions = new Set<string>();
  const sample = (i: number) => {
    const frame = timeline.frameAt(5 + i / 30), rec = recorder();
    const boxes: (Rect & { alpha: number })[] = [];
    rec.ctx.fillRect = (x, y, w, h) => { if (h === layout.readability.calloutHeight) boxes.push({ x, y, w, h, alpha: rec.ctx.globalAlpha }); };
    model.sx[model.n] = heads[i].x / 2; model.sy[model.n] = heads[i].y / 2; model.have[model.n] = 1;
    // Onscreen anchors keep the same slot, including changes of waypoint.
    drawCinematicGeography(rec.ctx, frame, route, enrichment, cfg, style,
      () => ({ x: (layout.work.x + layout.work.w / 2) / 2, y: 400 }), model, false, false, 1, () => sweep);
    expect(boxes).toHaveLength(1);
    const b = boxes[0], head = heads[i];
    positions.add(JSON.stringify([b.x, b.y, b.w, b.h]));
    expect(Math.hypot(Math.max(b.x - head.x, 0, head.x - b.x - b.w),
      Math.max(b.y - head.y, 0, head.y - b.y - b.h)) - radius).toBeGreaterThanOrEqual(24);
    const leader = rec.strokes.flatMap(s => s.segments)[0];
    expect(leader).toBeDefined();
    const r = radius + 24, zone = { x: head.x - r, y: head.y - r, w: 2 * r, h: 2 * r };
    expect(waypointLineIntersects([...leader.from, ...leader.to], zone, 0)).toBe(false);
    return b;
  };
  for (let i = 0; i < heads.length; i++) sample(i);
  // Fresh immutable sweeps produce the same slot; the cache is only an optimization.
  const reserved = [layout.caption, layout.stats, layout.profile];
  expect(placeJourneyCallout(layout.work, 300, layout.readability.calloutHeight, reserved, { heads: [...heads].reverse() }, radius + 24))
    .toEqual(placeJourneyCallout(layout.work, 300, layout.readability.calloutHeight, reserved, sweep, radius + 24));
  for (const i of [1450, 483, 0, 900, 1270, 12, 660]) sample(i);
  expect(positions.size).toBe(1);
  expect(sample(0).alpha).toBe(0); // Act boundary changes its slot while invisible.
  expect(sample(1).alpha).toBeGreaterThan(0);
  expect(sample(12).alpha).toBe(1);
});

it.each(['9:16', '16:9'] as const)('%s: якорь гаснет до границы и плавно возвращается даже после смены метки', format => {
  const l = layoutFor(format), viewport = { x: 0, y: 0, w: l.width, h: l.height };
  const inside = { x: l.width / 2, y: l.height / 2 }, outside = { x: -100, y: 400 };
  // A discrete change of anchor used to switch instantly from alpha=0 to alpha=1.
  const anchors = Array.from({ length: 121 }, (_, i) => i >= 45 && i <= 75 ? outside : inside);
  const sweep = { heads: [], anchors };
  const alphas = anchors.map((p, i) => calloutAnchorAlpha(p, viewport, i / 30, sweep));
  expect(alphas[30]).toBe(1);
  expect(alphas[41]).toBeGreaterThan(0);
  expect(alphas[41]).toBeLessThan(0.03);
  expect(alphas.slice(43, 78)).toEqual(Array(35).fill(0));
  expect(alphas[79]).toBeGreaterThan(0);
  expect(alphas[79]).toBeLessThan(0.03);
  expect(alphas[90]).toBe(1);
  for (let i = 1; i < alphas.length; i++) expect(Math.abs(alphas[i] - alphas[i - 1])).toBeLessThanOrEqual(0.125);
  for (const i of [76, 45, 90, 44, 30]) expect(calloutAnchorAlpha(anchors[i], viewport, i / 30, sweep)).toBe(alphas[i]);
  const oneOff = { heads: [], anchors: anchors.map((_p, i) => i === 60 ? outside : inside) };
  for (const i of [58, 59, 60, 61, 62]) expect(calloutAnchorAlpha(oneOff.anchors[i], viewport, i / 30, oneOff)).toBe(0);
  const edge = (x: number) => calloutAnchorAlpha({ x, y: inside.y }, viewport, 0);
  expect(edge(-1)).toBe(0); expect(edge(24)).toBe(0);
  expect(edge(72)).toBe(0.5); expect(edge(120)).toBe(1);

  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const cfg = settings({ format, durationSec: 60 }), enrichment = enrichmentFor(route), style = STYLES.epic;
  const timeline = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id));
  for (const point of [inside, { x: 72, y: inside.y }, outside, { x: l.width / 2, y: l.height + 1 }]) {
    const rec = recorder(), boxes: { alpha: number }[] = [];
    rec.ctx.fillRect = (_x, _y, _w, h) => { if (h === l.readability.calloutHeight) boxes.push({ alpha: rec.ctx.globalAlpha }); };
    drawCinematicGeography(rec.ctx, timeline.frameAt(30), route, enrichment, cfg, style,
      () => ({ x: point.x / 2, y: point.y / 2 }), prepareTrack(route), false, false, 1, () => ({ heads: [] }));
    expect(boxes).toHaveLength(1);
    expect(boxes[0].alpha).toBe(calloutAnchorAlpha(point, viewport, 30));
  }
});

it.each(['9:16', '16:9'] as const)('%s: вступление держит слот при движении якоря и изменении экранных препятствий', format => {
  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const cfg = settings({ format, durationSec: 60 }), enrichment = enrichmentFor(route), style = STYLES.epic;
  const l = layoutFor(format), timeline = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id));
  const points = Array.from({ length: 150 }, (_, i) => ({ x: l.width * 0.5 + i, y: l.height * 0.45 + i / 2 }));
  const labels = points.map((_p, i) => ({ x: 400 + i * 2, y: 800 + i * 2, w: 300, h: 44 }));
  const sweep = { heads: [], intro: { heads: points, reserved: labels } }, positions = new Set<string>();
  const model = prepareTrack(route), place = vi.spyOn(callouts, 'placeCallout');
  try {
    for (const i of [...points.keys(), 99, 110, 98, 109, 0]) {
      model.sx[0] = points[i].x / 2; model.sy[0] = points[i].y / 2; model.have[0] = 1;
      model.labelBoxes = [{ x: 200 + i, y: 400 + i, w: 150, h: 22 }];
      const rec = recorder(), boxes: (Rect & { alpha: number })[] = [];
      rec.ctx.fillRect = (x, y, w, h) => { if (h === l.readability.calloutHeight) boxes.push({ x, y, w, h, alpha: rec.ctx.globalAlpha }); };
      drawCinematicGeography(rec.ctx, timeline.frameAt(i / 30), route, enrichment, cfg, style,
        () => ({ x: points[i].x / 2, y: points[i].y / 2 }), model, false, false, 1, () => sweep);
      expect(boxes).toHaveLength(1);
      expect(boxes[0].alpha).toBeGreaterThan(0);
      const b = boxes[0];
      for (const r of labels) expect(b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y).toBe(false);
      positions.add(JSON.stringify([boxes[0].x, boxes[0].y]));
    }
    expect(place).not.toHaveBeenCalled();
    expect(positions.size).toBe(1);
  } finally { place.mockRestore(); }
});

it('диорама: Expedition содержит реальную векторную географию, DEM и высокий наклон; Atlas тоже включает DEM', () => {
  expect(STYLES.epic.pitch).toBeGreaterThanOrEqual(60);
  expect(STYLES.epic.line.color).toBe('#FF6654');
  expect(STYLES.epic.mapStyle.sources.ofm).toMatchObject({ type: 'vector' });
  expect(STYLES.epic.mapStyle.layers.some(l => l.type === 'line' && l.source === 'ofm' && l['source-layer'] === 'transportation')).toBe(true);
  expect(STYLES.atlas.mapStyle.terrain).toMatchObject({ source: 'dem' });
  expect(STYLES.atlas.terrain?.exaggeration).toBeGreaterThan(1);
  expect(STYLES.neon.terrain).toBeUndefined();
});

it.each(['9:16', '16:9'] as const)('%s: метки показывают один знак координат, трек — четыре; ширина следует тексту', format => {
  const widths: number[] = [];
  for (const mark of [true, false]) {
    const route = mark ? confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]) :
      lineRoute(20, { lat: 41, lon0: 28.9 });
    const enrichment = { ...enrichmentFor(route), placeAt: () => null,
      countryAt: () => ({ iso2: 'TD', nameRu: 'Чад', nameEn: 'Chad' }) };
    const cfg = settings({ format, durationSec: 60 }), style = STYLES.epic, l = layoutFor(format);
    const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(1);
    const { ctx, texts } = recorder();
    const place = vi.spyOn(callouts, 'placeCallout');
    try {
      drawCinematicGeography(ctx, frame, route, enrichment, cfg, style,
        () => ({ x: (l.work.x + l.work.w / 2) / 2, y: 400 }), prepareTrack(route), true, false);
      expect(texts).toContain(mark ? '41.0° / 28.9°' : '41.0000° / 28.9000°');
      expect(place).toHaveBeenCalledOnce();
      expect(place.mock.results[0].value).not.toBeNull();
      widths.push(place.mock.calls[0][2]);
    } finally {
      place.mockRestore();
    }
  }
  expect(widths[0]).toBeLessThan(widths[1]);
});

it.each(['9:16', '16:9'] as const)('%s: выноска и её линия обходят голову текущего кадра с запасом', format => {
  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(30);
  expect(frame.act).toBe('journey');
  const model = prepareTrack(route);
  const project = vi.fn(() => ({ x: 230, y: 400 })); // якорь выноски отличается от движущейся головы
  const place = vi.spyOn(callouts, 'placeCallout');
  const draw = () => {
    const recorded = recorder();
    drawCinematicGeography(recorded.ctx, frame, route, enrichment, cfg, style, project, model, true, false);
    return recorded;
  };
  try {
    draw();
    const oldBox = place.mock.results[0].value as Rect;
    expect(oldBox).not.toBeNull();
    // Регрессия: голова попала в середину прежней карточки; координаты берём из кеша track.ts.
    const head = { x: oldBox.x + oldBox.w / 2, y: oldBox.y + oldBox.h / 2 };
    model.sx[model.n] = head.x / 2; model.sy[model.n] = head.y / 2; model.have[model.n] = 1;
    place.mockClear(); project.mockClear();
    const recorded = draw();
    expect(project).toHaveBeenCalledOnce(); // не добавляем повторную проекцию головы
    const radius = style.marker.radius + style.marker.ringGap + style.marker.ringWidth + 2.2;
    const r = radius + 24;
    const zone = { x: head.x - r, y: head.y - r, w: r * 2, h: r * 2 };
    expect(place.mock.calls[0][4]).toContainEqual(zone);
    const box = place.mock.results[0].value as Rect;
    expect(box).not.toBeNull();
    expect(Math.hypot(Math.max(box.x - head.x, 0, head.x - box.x - box.w),
      Math.max(box.y - head.y, 0, head.y - box.y - box.h)) - radius).toBeGreaterThanOrEqual(24);
    const leader = recorded.strokes.flatMap(s => s.segments)[0];
    expect(leader).toBeDefined();
    expect(waypointLineIntersects([...leader.from, ...leader.to], zone, 0)).toBe(false);
    // В следующем кадре запрет следует за головой, старый прямоугольник не сохраняется.
    model.sx[model.n] += 100;
    place.mockClear();
    draw();
    const movedZone = place.mock.calls[0][4].find(o => o.w === zone.w && o.h === zone.h)!;
    expect(movedZone.x).toBeCloseTo(zone.x + 200, 10);
    expect(movedZone.y).toBe(zone.y);
    expect(place.mock.calls[0][4]).not.toContainEqual(zone);
  } finally {
    place.mockRestore();
  }
});

it.each(['9:16', '16:9'] as const)('%s: якорь совпал с головой — карточка остаётся, соединитель обходит кольцо', format => {
  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(30);
  const model = prepareTrack(route), { ctx, texts, strokes } = recorder();
  model.sx[model.n] = 230; model.sy[model.n] = 400; model.have[model.n] = 1;
  const place = vi.spyOn(callouts, 'placeCallout');
  try {
    drawCinematicGeography(ctx, frame, route, enrichment, cfg, style,
      () => ({ x: 230, y: 400 }), model, true, false);
    expect(place).toHaveBeenCalledOnce();
    expect(place.mock.results[0].value).not.toBeNull();
    expect(texts.some(s => s.includes('41.0°'))).toBe(true);
    const r = style.marker.radius + style.marker.ringGap + style.marker.ringWidth + 2.2 + 24;
    const zone = { x: 460 - r, y: 800 - r, w: r * 2, h: r * 2 };
    const leader = strokes.flatMap(s => s.segments)[0];
    expect(leader).toBeDefined();
    expect(waypointLineIntersects([...leader.from, ...leader.to], zone, 0)).toBe(false);
  } finally {
    place.mockRestore();
  }
});

it.each(['9:16', '16:9'] as const)('%s: outro оставляет флаг финиша и кольцо старта свободными', format => {
  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(58);
  expect(frame.act).toBe('outro');
  const model = prepareTrack(route), last = model.n - 1;
  // Синтетическая экранная геометрия: прежняя ближайшая карточка закрывала верх флага.
  model.sx[0] = 380; model.sy[0] = 360;
  model.sx[last] = 230; model.sy[last] = 400;
  model.have[0] = model.have[last] = 1;
  model.transferSeg.fill(1);
  // track.ts рисует сначала подпись финиша, затем старта (CSS-пиксели).
  model.labelBoxes = [{ x: 240, y: 440, w: 130, h: 20 }, { x: 340, y: 335, w: 100, h: 20 }];
  const finish: Rect = { x: 446, y: 734, w: 56, h: 80 };
  const r = style.marker.radius * 1.5 + Math.max(2, style.marker.ringWidth / 2 * 1.6) + 2.4;
  const start: Rect = { x: 760 - r, y: 720 - r, w: r * 2, h: r * 2 };
  const { ctx, texts } = recorder();
  const place = vi.spyOn(callouts, 'placeCallout');
  try {
    drawCinematicGeography(ctx, frame, route, enrichment, cfg, style,
      () => ({ x: 230, y: 400 }), model, true, false);
    expect(place).toHaveBeenCalledOnce();
    const box = place.mock.results[0].value as Rect | null;
    expect(box).not.toBeNull();
    expect(texts).toContain('Последняя точка записи');
    const center = { x: box!.x + box!.w / 2, y: box!.y + box!.h / 2 };
    const distance = Math.hypot(center.x - 460, center.y - 800);
    expect(distance).toBeLessThanOrEqual(2.5 * box!.h);
    expect(distance).toBeLessThan(Math.hypot(center.x - 760, center.y - 720));
    const label = model.labelBoxes[1];
    expect(distance).toBeLessThan(Math.hypot(
      center.x - Math.max(label.x * 2, Math.min((label.x + label.w) * 2, center.x)),
      center.y - Math.max(label.y * 2, Math.min((label.y + label.h) * 2, center.y))));
    for (const marker of [start, finish]) {
      expect(place.mock.calls[0][4]).toContainEqual(marker);
      expect(box!.x < marker.x + marker.w && box!.x + box!.w > marker.x &&
        box!.y < marker.y + marker.h && box!.y + box!.h > marker.y).toBe(false);
    }
  } finally {
    place.mockRestore();
  }
});

it.each(['9:16', '16:9'] as const)('%s: если локальная позиция невозможна, outro вызывает прежний подбор master', format => {
  const route = confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]);
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(58);
  const model = prepareTrack(route);
  model.transferSeg.fill(1);
  const place = vi.spyOn(callouts, 'placeCallout').mockReturnValue(null);
  try {
    drawCinematicGeography(recorder().ctx, frame, route, enrichment, cfg, style,
      () => ({ x: 230, y: 400 }), model, true, false);
    expect(place).toHaveBeenCalledTimes(2);
    expect(place.mock.calls[0][8]?.radius).toBe(2.5 * layoutFor(format).readability.calloutHeight);
    const legacy = place.mock.calls[1];
    expect(legacy).toHaveLength(7);
    expect(legacy.slice(0, 5)).toEqual(place.mock.calls[0].slice(0, 5));
    expect(legacy[5]).toEqual([]); // transferSeg и model.have, как в master, а не соединения меток.
    expect(legacy[6]).toEqual(place.mock.calls[0][6]);
  } finally {
    place.mockRestore();
  }
});

it.each(['9:16', '16:9'] as const)('%s: GPS во всех актах и journey меток используют прежний подбор', format => {
  for (const mark of [false, true]) for (const time of mark ? [30] : [1, 30, 58]) {
    const route = mark ? confirmedWaypointRoute([jw(41, 28.9, 'overnight', 0), jw(42, 29, 'overnight', 1)]) : lineRoute(20);
    const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
    const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(time);
    const place = vi.spyOn(callouts, 'placeCallout').mockReturnValue(null);
    try {
      drawCinematicGeography(recorder().ctx, frame, route, enrichment, cfg, style,
        () => ({ x: 230, y: 400 }), prepareTrack(route), true, false);
      expect(place).toHaveBeenCalledOnce();
      expect(place.mock.calls[0]).toHaveLength(7);
    } finally {
      place.mockRestore();
    }
  }
});

it.each(['9:16', '16:9'] as const)('%s: intro трека без глав резервирует легенду на всю рабочую ширину, как master', format => {
  const route = lineRoute(20), enrichment = enrichmentFor(route);
  const cfg = settings({ format }), style = STYLES.epic, l = layoutFor(format, style.id);
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(1);
  expect(route.chapters).toBeUndefined();
  expect(frame.act).toBe('intro');
  expect(frame.shot).toBeDefined();
  const { ctx } = recorder();
  const legendTop = overlayTitleBottom(ctx, frame,
    { route, enrichment, settings: cfg, style, reconstruction: false }) + 46 - l.readability.legendSize - 4;
  const place = vi.spyOn(callouts, 'placeCallout').mockReturnValue(null);
  try {
    drawCinematicGeography(ctx, frame, route, enrichment, cfg, style,
      () => ({ x: (l.work.x + l.work.w / 2) / 2, y: (l.work.y + l.work.h / 2) / 2 }),
      prepareTrack(route), true, false);
    expect(place).toHaveBeenCalledOnce();
    expect(place.mock.calls[0][4]).toContainEqual({
      x: l.work.x, y: legendTop, w: l.work.w, h: l.readability.legendHeight,
    });
  } finally {
    place.mockRestore();
  }
});

it.each(['9:16', '16:9'] as const)('%s: outro обходит точки и соединения меток вне TrackModel, когда есть место', format => {
  const route = confirmedWaypointRoute(Array.from({ length: 7 }, (_, i) => jw(40, 30 + i, 'overnight', i)));
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = STYLES.epic;
  const frame = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id)).frameAt(58);
  expect(frame.act).toBe('outro');
  // Реальный waypoint-layer не заполняет model.have для промежуточных меток.
  const xy = [[150, 760], [260, 800], [360, 840], [450, 850], [560, 810], [630, 760], [740, 800]];
  const project = (lon: number) => ({ x: xy[Math.round(lon - 30)][0] / 2, y: xy[Math.round(lon - 30)][1] / 2 });
  const model = prepareTrack(route), last = model.n - 1;
  for (const k of [0, last]) {
    const p = project(model.lon[k]);
    model.sx[k] = p.x; model.sy[k] = p.y; model.have[k] = 1;
  }
  model.transferSeg.fill(1); // не должно скрывать пунктирные соединения меток от placeCallout
  const { ctx, texts } = recorder();
  const place = vi.spyOn(callouts, 'placeCallout');
  try {
    drawCinematicGeography(ctx, frame, route, enrichment, cfg, style, project, model, true, false);
    const box = place.mock.results[0].value as Rect | null;
    expect(box).not.toBeNull();
    expect(texts).toContain('Последняя точка записи');
    const r = style.marker.radius + 2.8;
    for (const [x, y] of xy) {
      expect(box!.x < x + r && box!.x + box!.w > x - r &&
        box!.y < y + r && box!.y + box!.h > y - r).toBe(false);
    }
    for (let i = 1; i < xy.length; i++) {
      expect(waypointLineIntersects([xy[i - 1][0], xy[i - 1][1], xy[i][0], xy[i][1]], box!, 7)).toBe(false);
    }
  } finally {
    place.mockRestore();
  }
});

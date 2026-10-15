// Opt-in acceptance audit. Private inputs are read in place; only numeric timing and hashes leave memory.
import { it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { env } from 'node:process';
import { parseRouteFiles, buildRoute } from '../../src/route';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import { buildTimeline } from '../../src/story/timeline';
import { timelineOptionsFor } from '../../src/render/layout';
import type { Route, Enrichment } from '../../src/types';
import { settings, enrichmentFor } from './fixtures';
import { sevenChapterRoute } from './waypoint-fixtures';
import { mercX, mercY } from '../../src/story/mercator';
import { matchChapters } from '../../src/story/chapters';

function audit(route: Route, env: Enrichment, format: '9:16' | '16:9') {
  const tl = buildTimeline(route, env, settings({ format, durationSec: 60 }), timelineOptionsFor(format, 'epic'));
  const narrative: string[] = [];
  const rows = Array.from({ length: 1800 }, (_, i) => {
    const a = tl.frameAt(i / 30), b = tl.frameAt((i + 1) / 30);
    const { camera: _camera, ...rest } = a; narrative.push(JSON.stringify(rest));
    return { t: b.t, phase: a.act === b.act ? b.act : `${a.act}→${b.act}`, v: Math.abs(b.camera.zoom - a.camera.zoom) * 30 };
  });
  const maxima = Object.fromEntries(['all', ...new Set(rows.map(r => r.phase))].map(phase => [phase,
    rows.filter(r => phase === 'all' || r.phase === phase).sort((a, b) => b.v - a.v)[0]]));
  const plan = tl.waypointCameraPlan;
  // Overlapping phases are measured independently: a pullback must not hide a chapter exit.
  const ranges = plan ? [{ phase: 'dive', start: plan.diveFrom, end: plan.diveTo },
    ...plan.windows.flatMap((w, i) => [{ phase: `window${i + 1}-entry`, start: w.start, end: w.plateauStart },
      { phase: `window${i + 1}-plateau`, start: w.plateauStart, end: w.plateauEnd },
      { phase: `window${i + 1}-exit`, start: w.plateauEnd, end: w.end }]),
    { phase: 'pull', start: plan.pullFrom, end: plan.pullTo + 0.25 }] : [];
  const phases = Object.fromEntries(ranges.map(range => [range.phase, { ...range,
    max: rows.filter(r => r.t >= range.start && r.t - 1 / 30 <= range.end).sort((a, b) => b.v - a.v)[0] }]));
  const plain = buildTimeline({ ...route, chapters: undefined }, env, settings({ format, durationSec: 60 }), timelineOptionsFor(format, 'epic'));
  const timeAt = (timeline: typeof tl, idx: number): number => {
    if (idx === 0) return 7.94;
    let lo = 7.94, hi = 54;
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (timeline.frameAt(mid).head < idx) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  let gapFrom = 0;
  const gaps: { from: number; to: number }[] = [];
  for (const m of matchChapters(route, env).filter(m => !m.chapter.finale)) {
    if (m.fromIdx > gapFrom) gaps.push({ from: gapFrom, to: m.fromIdx });
    gapFrom = Math.max(gapFrom, m.toIdx);
  }
  if (gapFrom < route.points.length - 1) gaps.push({ from: gapFrom, to: route.points.length - 1 });
  const gapRetention = Math.min(...gaps.map(g => (timeAt(tl, g.to) - timeAt(tl, g.from)) / (timeAt(plain, g.to) - timeAt(plain, g.from))));
  let centerStep = 0, centerStepChange = 0, prev = [0, 0];
  for (let i = 1; i <= 1800; i++) {
    const a = tl.frameAt((i - 1) / 30).camera, b = tl.frameAt(i / 30).camera, world = 512 * 2 ** b.zoom;
    const v = [(mercX(b.center[0]) - mercX(a.center[0])) * world, (mercY(b.center[1]) - mercY(a.center[1])) * world];
    centerStep = Math.max(centerStep, Math.hypot(...v));
    centerStepChange = Math.max(centerStepChange, Math.hypot(v[0] - prev[0], v[1] - prev[1])); prev = v;
  }
  const intervals: { start: number; end: number }[] = [];
  let active: string | undefined, start = 0, movingAt = 0, noChapter = 0, journey = 0;
  for (let i = 0; i <= 18000; i++) {
    const t = i / 300, f = tl.frameAt(t), id = f.cards.find(c => c.chapter)?.chapter?.id;
    if (!movingAt && f.head > 0) movingAt = t;
    if (f.act === 'journey') { journey++; if (!id) noChapter++; }
    if (id !== active) { if (active) intervals.push({ start, end: t }); active = id; start = t; }
  }
  return { format, maxima, phases, plan, centerStep, centerStepChange, movingAt, gapRetention, noChapterShare: noChapter / journey, intervals,
    finale: Boolean(tl.frameAt(60).finalChapter), narrativeHash: createHash('sha256').update(new TextEncoder().encode(narrative.join(''))).digest('hex') };
}

const readText = (path: string) => new TextDecoder().decode(readFileSync(path));
it.skipIf(!env.RS_CAMERA_AUDIT)('numeric camera acceptance audit (no private payload saved)', async () => {
  const r = sevenChapterRoute();
  const paths = [env.RS_CAMERA_ROUTE!, env.RS_CAMERA_CHAPTERS!];
  const parsed = await parseRouteFiles(paths.map((path, i) => new File([readText(path)], i ? 'chapters.json' : 'waypoints.json')));
  if (!parsed.ok) throw new Error('Private import failed');
  const built = buildRoute(parsed.tracks);
  if ('error' in built) throw new Error('Private route build failed');
  const real = { ...built, chapters: parsed.chapters, waypointOrderConfirmed: true };
  const geo = createGeoIndex(JSON.parse(readText('public/data/countries.json')), JSON.parse(readText('public/data/places.json')));
  const result = { synthetic: (['9:16', '16:9'] as const).map(f => audit(r, enrichmentFor(r, { border: 100 }), f)),
    real: (['9:16', '16:9'] as const).map(f => audit(real, enrichRoute(real, geo), f)) };
  const out = join(tmpdir(), 'camera-proof2'); mkdirSync(out, { recursive: true });
  writeFileSync(join(out, `${env.RS_CAMERA_AUDIT}.json`), new TextEncoder().encode(JSON.stringify(result, null, 2)));
  console.log(JSON.stringify(result));
  expect(result.real.every(r => r.intervals.length + Number(r.finale) === 7)).toBe(true);
  if (env.RS_CAMERA_AUDIT !== 'before') {
    const before = JSON.parse(readText(join(out, 'before.json'))) as typeof result;
    for (const kind of ['synthetic', 'real'] as const) for (let i = 0; i < 2; i++) {
      const a = before[kind][i], b = result[kind][i];
      expect(b.narrativeHash).toBe(a.narrativeHash);
      expect(b.intervals).toEqual(a.intervals);
      expect(b.movingAt).toBe(a.movingAt);
      expect(b.noChapterShare).toBe(a.noChapterShare);
      expect(b.maxima.all.v).toBeLessThanOrEqual(0.600001);
      expect(b.gapRetention).toBeGreaterThanOrEqual(0.3 - 1e-8);
      expect(b.centerStep).toBeLessThan(40);
      expect(b.centerStepChange).toBeLessThan(5);
    }
  }
});

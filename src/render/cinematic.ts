import { countryName, formatAltitude, placeName, t } from '../i18n';
import { isWaypointRoute } from '../story/legs';
import { ACTS } from '../story/timeline';
import { FPS, type Enrichment, type FrameState, type Route, type StorySettings } from '../types';
import { placeCallout } from './callouts';
import { FONT_FAMILIES } from './fonts';
import { overlayAttributionRect, overlayChapterRect, overlayChapterReserve, overlayTitleBottom } from './overlay';
import { layoutFor, type Rect } from './layout';
import type { StyleDef } from './styles';
import type { Project, TrackModel } from './track';

type ScreenPoint = { x: number; y: number };
/** Immutable sweep, in design pixels. It is planned from the timeline, never from rendered frames. */
export interface CalloutSweep {
  heads: readonly ScreenPoint[];
  reserved?: readonly Rect[];
  /** Anchor at every timeline frame, including intro/outro; used for anticipatory fades. */
  anchors?: readonly ScreenPoint[];
  /** Hidden intervals for planned anchor/text changes, in film seconds. */
  changes?: readonly { from: number; to: number }[];
  /** Flat, immutable projections for choosing a readable landmark ahead of playback. */
  candidates?: { frames: readonly FrameState[]; points: readonly (readonly ScreenPoint[])[] };
  intro?: CalloutSweep;
}
const journeySlots = new WeakMap<CalloutSweep, Map<string, Rect | null>>();
const leaderChanges = new WeakMap<CalloutSweep, Map<string, { from: number; to: number }[]>>();
const smooth = (v: number) => { const u = Math.max(0, Math.min(1, v)); return u * u * (3 - 2 * u); };
const CALLOUT_FADE_SEC = 0.4;
// Keep a short hidden interval around an offscreen sample, rather than a one-frame blink.
const CALLOUT_HIDDEN_SEC = 0.1;

interface HeldCallout { start: number; end: number; index: number; number: number; trim: number }
const heldPlans = new WeakMap<CalloutSweep, Map<string, HeldCallout[]>>();
const HOLD_FADE_FRAMES = 6;
const HOLD_MIN_FRAMES = Math.ceil(2.5 * FPS);
const CHAPTER_READ_FRAMES = Math.ceil(3 * FPS);
const HOLD_GAP_FRAMES = 4;
// A 300 px cap cannot offer a 3 s hold in every chapter of the acceptance route
// (the geometric minimum is 467.13 px). Keep 20 px for flat/live DEM differences.
export const CALLOUT_MAX_HEAD_DISTANCE = 500;
const HEAD_DISTANCE_MARGIN = 20;

/** Schedule whole reading intervals, not every waypoint crossed by the moving head.
 * All decisions use the complete timeline. Seeking never advances mutable playback state. */
export function planHeldCallouts(sweep: CalloutSweep, box: Rect, radius: number, viewport: Rect,
  countries?: readonly (string | undefined)[]): HeldCallout[] {
  if (!sweep.candidates) return [];
  const key = JSON.stringify([box, radius, viewport, countries]);
  let cache = heldPlans.get(sweep);
  if (!cache) { cache = new Map(); heldPlans.set(sweep, cache); }
  const cached = cache.get(key);
  if (cached) return cached;
  const { frames, points } = sweep.candidates;
  const sameCountry = (i: number, index: number) => !countries || (!!countries[index]
    && countries[index] === countries[Math.floor(frames[i].head)]
    && countries[index] === frames[i].stats.country?.iso2);
  const first = frames.findIndex(f => f.act === 'journey');
  if (first < 0) return [];
  let last = first;
  while (last < frames.length && frames[last].act === 'journey') last++;
  type Run = { start: number; end: number; index: number };
  const runs: Run[] = [];
  for (let index = 0; index < points[first].length; index++) {
    let start = first, previous: ScreenPoint | undefined;
    for (let i = first; i <= last; i++) {
      const p = points[i]?.[index];
      const safe = i < last && p && sameCountry(i, index) && Number.isFinite(p.x + p.y)
        && Math.hypot(p.x - sweep.heads[i - first].x, p.y - sweep.heads[i - first].y)
          <= CALLOUT_MAX_HEAD_DISTANCE - HEAD_DISTANCE_MARGIN
        && p.x >= viewport.x + 120 && p.x <= viewport.x + viewport.w - 120
        && p.y >= viewport.y + 120 && p.y <= viewport.y + viewport.h - 120
        && (!previous || Math.hypot(p.x - previous.x, p.y - previous.y) <= 24.5);
      if (!safe) {
        if (i - start >= HOLD_MIN_FRAMES + 2 * HOLD_FADE_FRAMES) runs.push({ start, end: i, index });
        start = i + 1;
      }
      previous = p;
    }
  }
  const chapters = new Map<string, { start: number; end: number }>();
  for (let i = first; i < last; i++) for (const card of frames[i].cards) if (card.chapter) {
    const old = chapters.get(card.chapter.id);
    if (old) old.end = i + 1;
    else chapters.set(card.chapter.id, { start: i, end: i + 1 });
  }
  const bookings: (Run & { coreStart: number; coreEnd: number })[] = [];
  for (const chapter of chapters.values()) {
    const middleHead = frames[Math.floor((chapter.start + chapter.end) / 2)].head;
    const options = runs.map(run => ({ ...run,
      coreStart: Math.max(chapter.start, run.start + HOLD_FADE_FRAMES),
      coreEnd: Math.min(chapter.end, run.end - HOLD_FADE_FRAMES),
    })).filter(a => a.coreEnd - a.coreStart >= CHAPTER_READ_FRAMES)
      // Once the chapter is readable, prefer a hold that bridges toward the next
      // chapter. Maximizing overlap alone can leave an unfillable hidden gap.
      .sort((a, b) => b.end - a.end
      || Math.abs(a.index - middleHead) - Math.abs(b.index - middleHead));
    const best = options[0];
    if (!best || best.coreEnd - best.coreStart < CHAPTER_READ_FRAMES) continue;
    const previous = bookings.at(-1);
    if (previous && previous.index === best.index && best.start <= previous.end) {
      previous.end = Math.max(previous.end, best.end); previous.coreEnd = best.coreEnd;
    } else bookings.push(best);
  }
  const segments: Run[] = bookings.map(b => ({ start: b.start, end: b.end, index: b.index }));
  for (let i = 1; i < segments.length; i++) {
    const boundary = Math.floor((bookings[i - 1].coreEnd + bookings[i].coreStart) / 2);
    segments[i - 1].end = Math.min(segments[i - 1].end, boundary - HOLD_GAP_FRAMES / 2);
    segments[i].start = Math.max(segments[i].start, boundary + HOLD_GAP_FRAMES / 2);
  }
  // Fill remaining long gaps with whole readable cards; short intermediate landmarks are skipped.
  const gaps = segments.length ? [
    { start: first, end: segments[0].start - HOLD_GAP_FRAMES },
    ...segments.slice(1).map((s, i) => ({ start: segments[i].end + HOLD_GAP_FRAMES, end: s.start - HOLD_GAP_FRAMES })),
    { start: segments.at(-1)!.end + HOLD_GAP_FRAMES, end: last },
  ] : [{ start: first, end: last }];
  while (gaps.length) {
    const gap = gaps.pop()!;
    const choices = runs.map(r => ({ ...r, start: Math.max(r.start, gap.start), end: Math.min(r.end, gap.end) }))
      .filter(r => r.end - r.start >= HOLD_MIN_FRAMES + 2 * HOLD_FADE_FRAMES)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start)
        || Math.abs(a.index - frames[Math.floor((a.start + a.end) / 2)].head)
          - Math.abs(b.index - frames[Math.floor((b.start + b.end) / 2)].head));
    if (!choices.length) continue;
    const chosen = choices[0]; segments.push(chosen);
    gaps.push({ start: gap.start, end: chosen.start - HOLD_GAP_FRAMES },
      { start: chosen.end + HOLD_GAP_FRAMES, end: gap.end });
  }
  segments.sort((a, b) => a.start - b.start);
  // Use the edge margin for a fade, rather than spending it completely hidden.
  // Full-opacity bookings above still require the entire 120 px margin.
  const fadeSafe = (i: number, index: number) => {
    const p = points[i]?.[index], previous = points[i - 1]?.[index];
    return i >= first && i < last && p && previous && sameCountry(i, index)
      && p.x > viewport.x + 24 && p.x < viewport.x + viewport.w - 24
      && p.y > viewport.y + 24 && p.y < viewport.y + viewport.h - 24
      && Math.hypot(p.x - previous.x, p.y - previous.y) <= 24.5;
  };
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i], start = s.start, end = s.end;
    const lower = i ? segments[i - 1].end + HOLD_GAP_FRAMES : first;
    const upper = i + 1 < segments.length ? segments[i + 1].start - HOLD_GAP_FRAMES : last;
    // Extend only the fade: extending by more would put full-opacity frames
    // outside the distance-bounded run that was booked above.
    while (s.start > Math.max(lower, start - HOLD_FADE_FRAMES) && fadeSafe(s.start - 1, s.index)) s.start--;
    while (s.end < Math.min(upper, end + HOLD_FADE_FRAMES) && fadeSafe(s.end, s.index)) s.end++;
  }
  const result = segments.map(s => {
    // One trim fraction for the whole hold: convex combinations of anchor/card endpoints
    // cannot move faster than those endpoints. Reserve 8 px for live DEM differences.
    let trim = 0;
    for (let i = s.start; i < s.end; i++) {
      const p = points[i][s.index], head = sweep.heads[i - first];
      const to = { x: Math.max(box.x, Math.min(box.x + box.w, p.x)), y: Math.max(box.y, Math.min(box.y + box.h, p.y)) };
      const r = radius + 8;
      const from = leaderAfterHead(p, to, { x: head.x - r, y: head.y - r, w: 2 * r, h: 2 * r });
      const length = Math.hypot(to.x - p.x, to.y - p.y);
      if (length > 1e-9) trim = Math.max(trim, Math.hypot(from.x - p.x, from.y - p.y) / length);
    }
    return { ...s, trim, number: frames[Math.floor((s.start + s.end) / 2)].shot?.number ?? 1 };
  });
  cache.set(key, result);
  return result;
}

/** Dense changes share one fade, rather than flashing an unreadable card between waypoints. */
export function calloutChangeWindows(times: readonly number[]): { from: number; to: number }[] {
  return mergeChangeWindows(times.map(time => ({
    // The exact change can occur anywhere between two timeline samples. Hide both sides.
    from: time - 1 / FPS - CALLOUT_HIDDEN_SEC, to: time + CALLOUT_HIDDEN_SEC,
  })));
}

function mergeChangeWindows(items: readonly { from: number; to: number }[]): { from: number; to: number }[] {
  const windows: { from: number; to: number }[] = [];
  for (const { from, to } of items) {
    const prev = windows.at(-1);
    if (prev && from - prev.to <= 2 * CALLOUT_FADE_SEC) prev.to = Math.max(prev.to, to);
    else windows.push({ from, to });
  }
  return windows;
}

function changesAlpha(time: number, windows: readonly { from: number; to: number }[]): number {
  return windows.reduce((alpha, { from, to }) =>
    Math.min(alpha, smooth(Math.max(from - time, time - to) / CALLOUT_FADE_SEC)), 1);
}

/** Fade inside the viewport, before an anchor leaves (or changes to an offscreen waypoint).
 * The symmetric time envelope also fades in after re-entry, independently of render/seek order. */
export function calloutAnchorAlpha(point: ScreenPoint, viewport: Rect, time: number, sweep?: CalloutSweep): number {
  const edgeAlpha = (p: ScreenPoint) => Number.isFinite(p.x) && Number.isFinite(p.y) ? smooth((Math.min(
    p.x - viewport.x, viewport.x + viewport.w - p.x,
    p.y - viewport.y, viewport.y + viewport.h - p.y) - 24) / 96) : 0;
  let alpha = Math.min(edgeAlpha(point), changesAlpha(time, sweep?.changes ?? []));
  const anchors = sweep?.anchors;
  if (anchors) {
    const window = CALLOUT_FADE_SEC + CALLOUT_HIDDEN_SEC;
    const first = Math.max(0, Math.ceil((time - window) * FPS));
    const last = Math.min(anchors.length - 1, Math.floor((time + window) * FPS));
    for (let i = first; i <= last; i++) {
      alpha = Math.min(alpha, edgeAlpha(anchors[i]) + smooth((Math.abs(time - i / FPS) - CALLOUT_HIDDEN_SEC) / CALLOUT_FADE_SEC));
    }
  }
  return alpha;
}

/** One screen slot for the entire journey, including every change of city/coordinates. */
export function placeJourneyCallout(bounds: Rect, w: number, h: number, reserved: Rect[],
  sweep: CalloutSweep, radius: number): Rect | null {
  let slots = journeySlots.get(sweep);
  if (!slots) { slots = new Map(); journeySlots.set(sweep, slots); }
  const key = JSON.stringify([bounds, w, h, reserved, radius]);
  if (slots.has(key)) return slots.get(key)!;
  const zones = sweep.heads.map(p => ({ x: p.x - radius, y: p.y - radius, w: 2 * radius, h: 2 * radius }));
  const obstacles = [...reserved, ...(sweep.reserved ?? []), ...zones];
  const xs = [bounds.x, bounds.x + bounds.w - w], ys = [bounds.y, bounds.y + bounds.h - h];
  for (let x = bounds.x; x + w <= bounds.x + bounds.w; x += 12) xs.push(x);
  for (let y = bounds.y; y + h <= bounds.y + bounds.h; y += 12) ys.push(y);
  for (const r of reserved) ys.push(r.y + r.h + 8, r.y - h - 8);
  let box: Rect | null = null, score = Infinity;
  for (const x of new Set(xs)) for (const y of new Set(ys)) {
    if (x < bounds.x || y < bounds.y || x + w > bounds.x + bounds.w || y + h > bounds.y + bounds.h) continue;
    if (obstacles.some(o => x < o.x + o.w + 6 && x + w + 6 > o.x && y < o.y + o.h + 6 && y + h + 6 > o.y)) continue;
    const d = (x + w / 2 - bounds.x - bounds.w / 2) ** 2 + (y + h / 2 - bounds.y - bounds.h / 2) ** 2;
    if (d < score) { score = d; box = { x, y, w, h }; }
  }
  slots.set(key, box);
  return box;
}

/** Trim the leader beyond the protected head square, even when its anchor is outside it. */
function leaderAfterHead(from: ScreenPoint, to: ScreenPoint, zone?: Rect): ScreenPoint {
  if (!zone) return from;
  const dx = to.x - from.x, dy = to.y - from.y;
  let lo = 0, hi = 1;
  for (const [a, d, min, max] of [[from.x, dx, zone.x - 2, zone.x + zone.w + 2],
    [from.y, dy, zone.y - 2, zone.y + zone.h + 2]]) {
    if (Math.abs(d) < 1e-9) { if (a < min || a > max) return from; continue; }
    const u = (min - a) / d, v = (max - a) / d;
    lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
    if (lo > hi) return from;
  }
  return { x: from.x + dx * hi, y: from.y + dy * hi };
}

/** A leader can also switch discretely when it stops intersecting the protected head square.
 * Plan that topology change on the same immutable sweep; keep the existing safe geometry. */
export function calloutLeaderAlpha(sweep: CalloutSweep, box: Rect, radius: number, journeyStart: number, time: number): number {
  if (!sweep.anchors) return 1;
  let plans = leaderChanges.get(sweep);
  if (!plans) { plans = new Map(); leaderChanges.set(sweep, plans); }
  const key = JSON.stringify([box, radius, journeyStart]);
  let windows = plans.get(key);
  if (!windows) {
    const times: number[] = [], first = Math.round(journeyStart * FPS);
    let previous: boolean | undefined;
    sweep.heads.forEach((head, i) => {
      const anchor = sweep.anchors![first + i];
      if (!anchor) return;
      const to = { x: Math.max(box.x, Math.min(box.x + box.w, anchor.x)),
        y: Math.max(box.y, Math.min(box.y + box.h, anchor.y)) };
      const from = leaderAfterHead(anchor, to, { x: head.x - radius, y: head.y - radius, w: radius * 2, h: radius * 2 });
      const clipped = Math.hypot(from.x - anchor.x, from.y - anchor.y) > 1e-6;
      if (previous !== undefined && clipped !== previous) times.push((first + i) / FPS);
      previous = clipped;
    });
    windows = mergeChangeWindows([...calloutChangeWindows(times), ...(sweep.changes ?? [])].sort((a, b) => a.from - b.from));
    plans.set(key, windows);
  }
  return changesAlpha(time, windows);
}

/** Один буфер на сцену, половинное разрешение; карта размывается, линия и текст остаются чёткими. */
export function applyTiltShift(ctx: CanvasRenderingContext2D, buffer: HTMLCanvasElement, pitch: number, focus: number): void {
  if (pitch < 0.02 || focus < 0.05) return;
  const { width: w, height: h } = ctx.canvas;
  const bw = Math.round(w / 2), bh = Math.round(h / 2);
  if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
  const g = buffer.getContext('2d')!;
  g.clearRect(0, 0, bw, bh);
  g.filter = `blur(${Math.min(w, h) / 450}px)`;
  g.drawImage(ctx.canvas, 0, 0, bw, bh);
  g.filter = 'none';
  const mask = g.createLinearGradient(0, 0, 0, bh);
  mask.addColorStop(0, 'rgba(0,0,0,0.95)');
  mask.addColorStop(0.24, 'rgba(0,0,0,0.25)');
  mask.addColorStop(0.38, 'rgba(0,0,0,0)');
  mask.addColorStop(0.68, 'rgba(0,0,0,0)');
  mask.addColorStop(0.86, 'rgba(0,0,0,0.3)');
  mask.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = mask; g.fillRect(0, 0, bw, bh);
  g.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.globalAlpha = Math.min(0.22, pitch * focus * 0.22);
  ctx.drawImage(buffer, 0, 0, w, h); ctx.restore();
}

export function drawCinematicGeography(ctx: CanvasRenderingContext2D, frame: FrameState, route: Route,
  enrichment: Enrichment, settings: StorySettings, style: StyleDef, project: Project, model: TrackModel,
  dem: boolean, reconstruction: boolean, terrainScale = 1,
  journeySweep?: () => CalloutSweep): void {
  if (!frame.shot) return;
  const l = layoutFor(settings.format, style.id), lang = settings.lang;
  const sizes = l.readability;
  const mark = isWaypointRoute(route), overview = mark && !route.waypointOrderConfirmed;
  ctx.save();
  ctx.font = `500 ${sizes.legendSize}px '${FONT_FAMILIES.mono}', monospace`;
  ctx.textBaseline = 'alphabetic';
  const source = t(lang, mark ? 'film.marks' : reconstruction ? 'film.reconstruction' : 'film.recorded');
  const terrain = dem ? `${t(lang, 'film.dem')} ×${terrainScale.toFixed(2)}` : t(lang, 'film.flat');
  const trust = `${source} · ${terrain}`;
  const data = { route, enrichment, settings, style, reconstruction };
  const chapter = overlayChapterRect(ctx, frame, data);
  const reserve = overlayChapterReserve(ctx, frame, data);
  const planned = mark ? journeySweep?.() : undefined;
  let ty = Math.max(frame.act === 'journey' ? l.caption.y + l.caption.h + 56 :
    overlayTitleBottom(ctx, frame, data) + 46, reserve ? reserve.y + reserve.h + 46 : 0);
  let legendTop = ty - sizes.legendSize - 4;
  // В широком кадре оставляем колонку показателей/итогов свободной, в вертикальном — рабочую ширину.
  const maxLegendWidth = settings.format === '16:9'
    ? (frame.act === 'outro' ? l.summary.x : l.stats.x) - l.work.x - 20 : l.work.w;
  let legend = { x: l.work.x, y: legendTop, w: Math.min(maxLegendWidth, ctx.measureText(trust).width + 24), h: sizes.legendHeight };
  if (frame.act === 'journey' && planned) {
    const radius = style.marker.radius + style.marker.ringGap + style.marker.ringWidth + 2.2 + 35;
    if (planned.heads.some(p => p.x + radius > legend.x && p.x - radius < legend.x + legend.w
      && p.y + radius > legend.y && p.y - radius < legend.y + legend.h)) {
      const slot = placeJourneyCallout(l.work, legend.w, legend.h,
        [reserve ?? l.caption, l.stats, l.profile, overlayAttributionRect(ctx, frame, data)], planned, radius);
      if (slot) legend = slot;
    }
    legendTop = legend.y; ty = legendTop + sizes.legendSize + 4;
  }
  ctx.fillStyle = style.palette.cardBg; ctx.fillRect(legend.x, legend.y, legend.w, legend.h);
  ctx.fillStyle = style.palette.text; ctx.fillText(trust, legend.x + 10, ty, legend.w - 24);
  if (overview) { ctx.restore(); return; } // Подписи T24; нумерация не создаёт хронологию меток.
  // Настоящая координата из файла, без интерполяции между сегментами.
  let idx = frame.act === 'intro' ? 0 : frame.act === 'outro' ? route.points.length - 1 : Math.floor(frame.head);
  const p = route.points[idx], anchor = project(p.lon, p.lat);
  let point = { x: anchor.x * 2, y: anchor.y * 2 };
  const stableJourney = frame.act === 'journey' && planned;
  const stableIntro = frame.act === 'intro' && planned?.intro;
  if (!mark && (point.x < l.work.x || point.y < l.work.y || point.x > l.work.x + l.work.w || point.y > l.work.y + l.work.h)) {
    ctx.restore(); return;
  }
  const place = enrichment.placeAt(idx), country = enrichment.countryAt(idx);
  let title = frame.act === 'outro' ? t(lang, 'film.lastPoint') : place ?
    `${t(lang, 'label.city')}: ${placeName(lang, place)}` : country ? countryName(lang, country) : t(lang, 'film.coordinate');
  const precision = mark ? 1 : 4;
  const coords = `${p.lat.toFixed(precision)}° / ${p.lon.toFixed(precision)}°`;
  let detail = !mark && p.ele !== undefined && Number.isFinite(p.ele) ?
    `${coords} · ${formatAltitude(lang, p.ele)}` : coords;
  ctx.font = `600 ${sizes.calloutTitle}px ${style.fonts.label}`;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = `500 ${sizes.calloutDetail}px '${FONT_FAMILIES.mono}', monospace`;
  const detailWidth = ctx.measureText(detail).width;
  let w = Math.min(l.work.w, settings.format === '16:9' ? Math.max(titleWidth + 68, detailWidth + 32) :
    Math.max(titleWidth, detailWidth) + 88), h = sizes.calloutHeight;
  // A changing string must not move or resize the journey's card. Measure the complete vocabulary.
  if (stableJourney) {
    for (let i = 0; i < route.points.length; i++) {
      const p = route.points[i], place = enrichment.placeAt(i), country = enrichment.countryAt(i);
      const title = place ? `${t(lang, 'label.city')}: ${placeName(lang, place)}` :
        country ? countryName(lang, country) : t(lang, 'film.coordinate');
      ctx.font = `600 ${sizes.calloutTitle}px ${style.fonts.label}`;
      const tw = ctx.measureText(title).width;
      ctx.font = `500 ${sizes.calloutDetail}px '${FONT_FAMILIES.mono}', monospace`;
      const dw = ctx.measureText(`${p.lat.toFixed(1)}° / ${p.lon.toFixed(1)}°`).width;
      w = Math.max(w, Math.min(l.work.w, settings.format === '16:9' ? Math.max(tw + 68, dw + 32) : Math.max(tw, dw) + 88));
    }
  }
  const segments: [number, number, number, number][] = [];
  const routeMarkers: Rect[] = [];
  const legacySegments: [number, number, number, number][] = [];
  for (let k = 1; k < model.n; k++) {
    if (model.transferSeg[k - 1] || !model.have[k - 1] || !model.have[k]) continue;
    legacySegments.push([model.sx[k - 1] * 2, model.sy[k - 1] * 2, model.sx[k] * 2, model.sy[k] * 2]);
  }
  if (mark && frame.act === 'outro') {
    // waypoint-layer проецирует метки отдельно от TrackModel, включая тихие будущие участки.
    // Берём ту же геометрию, а не прореженный display и transferSeg GPS-трека.
    const points = (route.journeyWaypoints ?? []).map(p => project(p.lon, p.lat));
    const r = style.marker.radius + 2.8; // запас под точку, ромб, значок и обводку
    points.forEach((p, i) => {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      routeMarkers.push({ x: p.x * 2 - r, y: p.y * 2 - r, w: r * 2, h: r * 2 });
      const prev = points[i - 1];
      if (prev && Number.isFinite(prev.x) && Number.isFinite(prev.y)) {
        segments.push([prev.x * 2, prev.y * 2, p.x * 2, p.y * 2]);
      }
    });
  }
  // Габариты drawStart/drawFinish (track.ts), включая обводку, из CSS- в дизайн-пиксели.
  const markers: Rect[] = [];
  if (model.n >= 2) {
    const last = model.n - 1;
    const r = style.marker.radius * 1.5 + Math.max(2, style.marker.ringWidth / 2 * 1.6) + 2.4;
    if (model.have[0]) markers.push({ x: model.sx[0] * 2 - r, y: model.sy[0] * 2 - r, w: r * 2, h: r * 2 });
    if (model.have[last] && (frame.showFinish || (mark && frame.act !== 'journey'))) {
      markers.push({ x: model.sx[last] * 2 - 14, y: model.sy[last] * 2 - 66, w: 56, h: 80 });
    }
  }
  // Последний слот — уже спроецированная голова именно этого кадра (CSS-пиксели).
  // Защищаем всё кольцо и ещё 24 дизайн-пикселя; препятствие действует и на линию выноски.
  const headZone: Rect[] = [];
  if (frame.act === 'journey' && model.have[model.n]) {
    const m = style.marker;
    const r = Math.max(m.radius + m.ringGap + m.ringWidth + 2.2, m.glow > 0 ? m.radius * 4.2 : 0) + 24;
    headZone.push({ x: model.sx[model.n] * 2 - r, y: model.sy[model.n] * 2 - r, w: r * 2, h: r * 2 });
  }
  const leaderOrigins = headZone.length ? [...markers, ...headZone] : markers;
  const reserved: Rect[] = [chapter ?? l.caption, l.stats, l.profile,
    ...markers, ...headZone,
    ...(model.labelBoxes ?? []).map(r => ({ x: r.x * 2, y: r.y * 2, w: r.w * 2, h: r.h * 2 })),
    { x: l.work.x, y: legendTop, w: l.work.w, h: sizes.legendHeight },
    overlayAttributionRect(ctx, frame, { route, enrichment, settings, style, reconstruction }),
    ...(frame.act !== 'journey' ? [l.title, l.summary] : [])];
  const bounds = frame.act !== 'journey' && l.summaryDock === 'right' ?
    { ...l.work, w: l.summary.x - 20 - l.work.x } : l.work;
  // В общих планах меток track.ts записывает подписи в порядке «финиш, старт».
  const startLabel = model.labelBoxes?.[1];
  const avoid: Rect[] = model.have[0] ? [{ x: model.sx[0] * 2, y: model.sy[0] * 2, w: 0, h: 0 }] : [];
  if (startLabel) avoid.push({ x: startLabel.x * 2, y: startLabel.y * 2, w: startLabel.w * 2, h: startLabel.h * 2 });
  const fixedReserved = [reserve ?? l.caption, l.stats, l.profile,
      { x: l.work.x, y: legendTop, w: l.work.w, h: sizes.legendHeight },
      overlayAttributionRect(ctx, frame, { route, enrichment, settings, style, reconstruction })];
  const protectedRadius = Math.max(style.marker.radius + style.marker.ringGap + style.marker.ringWidth + 2.2,
    style.marker.glow > 0 ? style.marker.radius * 4.2 : 0) + 24;
  // Cards need 35 px around the head; leaders keep their separate 25 px protection.
  const box = stableJourney ? placeJourneyCallout(bounds, w, h, fixedReserved, planned, protectedRadius + 12) :
    stableIntro ? placeJourneyCallout(bounds, w, h, [...fixedReserved, l.title, l.summary], stableIntro, protectedRadius + 12) :
    ((mark && frame.act === 'outro' ?
    placeCallout(point, bounds, w, h, reserved, segments, leaderOrigins, routeMarkers, { radius: 2.5 * h, avoid }) : null)
    // Если рядом нет допустимого места — в точности прежний подбор master, включая геометрию TrackModel.
    ?? placeCallout(point, bounds, w, h, reserved, legacySegments, leaderOrigins));
  if (box) {
    let heldAlpha: number | undefined, number = frame.shot.number;
    let heldTrim = 0;
    if (stableJourney && planned.candidates) {
      const intervals = planHeldCallouts(planned, box, protectedRadius, { x: 0, y: 0, w: l.width, h: l.height },
        route.points.map((_, i) => enrichment.countryAt(i)?.iso2));
      const rawSample = frame.t * FPS;
      // frameAt(i / FPS) may round just below an interval boundary. Both the
      // content lookup and its fade must use that same exact zero frame.
      const sample = Math.abs(rawSample - Math.round(rawSample)) < 1e-7 ? Math.round(rawSample) : rawSample;
      // Keep the previous content through the hidden gap. Switch only on the new interval's zero frame.
      let held = intervals[0];
      for (const interval of intervals) if (interval.start <= sample) held = interval;
      heldAlpha = 0;
      if (held) {
        heldTrim = held.trim;
        idx = held.index; number = held.number;
        const p = route.points[idx], anchor = project(p.lon, p.lat);
        point = { x: anchor.x * 2, y: anchor.y * 2 };
        const place = enrichment.placeAt(idx), country = enrichment.countryAt(idx);
        title = place ? `${t(lang, 'label.city')}: ${placeName(lang, place)}` :
          country ? countryName(lang, country) : t(lang, 'film.coordinate');
        detail = `${p.lat.toFixed(1)}° / ${p.lon.toFixed(1)}°`;
        heldAlpha = Math.min(smooth((sample - held.start) / HOLD_FADE_FRAMES),
          smooth((held.end - 1 - sample) / HOLD_FADE_FRAMES));
      }
    }
    // Different act layouts exchange cards through a fade, never through a visible slot switch.
    const acts = ACTS[settings.durationSec];
    const edge = CALLOUT_FADE_SEC;
    const actAlpha = !planned ? 1 : frame.act === 'intro' ? smooth((acts.intro - frame.t) / edge) :
      frame.act === 'journey' ? Math.min(smooth((frame.t - acts.intro) / edge), smooth((acts.journeyEnd - frame.t) / edge)) :
        smooth((frame.t - acts.journeyEnd) / edge);
    const leaderAlpha = heldAlpha ?? (stableJourney ? calloutLeaderAlpha(planned, box, protectedRadius, acts.intro, frame.t) : 1);
    // The plan anticipates distance exits; this continuous live-projection guard
    // also enforces the cap if terrain differs from the flat planning transform.
    const proximityAlpha = stableJourney && model.have[model.n] ? smooth((CALLOUT_MAX_HEAD_DISTANCE + HEAD_DISTANCE_MARGIN
      - Math.hypot(point.x - model.sx[model.n] * 2, point.y - model.sy[model.n] * 2)) / HEAD_DISTANCE_MARGIN) : 1;
    const calloutAlpha = actAlpha * Math.min(leaderAlpha, proximityAlpha,
      mark ? calloutAnchorAlpha(point, { x: 0, y: 0, w: l.width, h: l.height }, frame.t,
        heldAlpha === undefined ? planned : undefined) : 1);
    const x = Math.max(box.x, Math.min(box.x + box.w, point.x));
    const y = Math.max(box.y, Math.min(box.y + box.h, point.y));
    const clipped = leaderAfterHead(point, { x, y }, headZone[0]);
    const length = Math.hypot(x - point.x, y - point.y);
    const trim = Math.max(heldTrim, length > 1e-9 ? Math.hypot(clipped.x - point.x, clipped.y - point.y) / length : 0);
    const from = heldAlpha === undefined ? clipped : { x: point.x + (x - point.x) * trim, y: point.y + (y - point.y) * trim };
    ctx.strokeStyle = style.palette.accent; ctx.lineWidth = 1.5; ctx.globalAlpha = calloutAlpha * 0.8;
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.globalAlpha = calloutAlpha; ctx.fillStyle = style.palette.cardBg; ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.beginPath(); ctx.arc(box.x + 28, box.y + 30, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = style.palette.text; ctx.font = `500 18px '${FONT_FAMILIES.mono}', monospace`;
    ctx.textAlign = 'center'; ctx.fillText(String(number).padStart(2, '0'), box.x + 28, box.y + 36);
    ctx.textAlign = 'left'; ctx.font = `600 ${sizes.calloutTitle}px ${style.fonts.label}`;
    ctx.fillText(title, box.x + 56, box.y + 37 + (sizes.calloutTitle - 28), box.w - 68);
    ctx.font = `500 ${sizes.calloutDetail}px '${FONT_FAMILIES.mono}', monospace`;
    ctx.fillStyle = style.palette.secondary; ctx.fillText(detail, box.x + 16, box.y + h - 20, box.w - 32);
  }
  ctx.restore();
}

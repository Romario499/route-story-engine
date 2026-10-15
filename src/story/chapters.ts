import type { Chapter, ChapterMood, ChapterMoodState, Enrichment, Route } from '../types';
import type { PacePlan } from './pace';
export interface MatchedChapter { chapter: Chapter; fromIdx: number; toIdx: number }
export interface CountryReadingRun { fromIdx: number; toIdx: number }
export interface ReadingBudget { runs: CountryReadingRun[]; last: number; labelSec: number; firstDelaySec: number;
  /** Base plan's geometric cost, before its global edge ramp and velocity smoothing. */
  positionWeights?: Float64Array;
  result?: { feasible: boolean; requiredSec: number; availableSec: number } }
/** Не добавляет координаты: совпадения только по реальным меткам, включая остановки/поезда. */
export function matchChapters(route: Route, enrichment: Enrichment): MatchedChapter[] {
  if (route.source?.kind !== 'waypoints' || !route.journeyWaypoints) return [];
  const out: MatchedChapter[] = [];
  for (const chapter of route.chapters ?? []) {
    let start = -1;
    const a = chapter.anchor;
    for (let i = 0; i <= route.journeyWaypoints.length; i++) {
      const m = route.journeyWaypoints[i];
      const b = a.region?.bbox;
      const hit = m && a.countries.includes(enrichment.countryAt(i)?.iso2 ?? '')
        && (!a.markedAt || (m.markedAt !== undefined && m.markedAt >= a.markedAt.from && m.markedAt <= a.markedAt.to))
        && (!b || (m.lon >= b[0] && m.lat >= b[1] && m.lon <= b[2] && m.lat <= b[3]));
      if (hit && start < 0) start = i;
      if (!hit && start >= 0) { out.push({ chapter, fromIdx: start, toIdx: i - 1 }); start = -1; }
    }
  }
  return out.sort((a, b) => a.fromIdx - b.fromIdx);
}

/** Резервирует чтение внутри совпавших регионов, перераспределяя движение, без новых стоянок. */
export function paceWithChapterReading(base: PacePlan, matched: MatchedChapter[], moveSec: number, readingSec: (chapter: Chapter) => number, budget?: ReadingBudget): PacePlan {
  if (budget) return paceWithCountryReading(base, matched, moveSec, readingSec, budget);
  const chosen = new Map<string, MatchedChapter>();
  for (const m of matched) {
    if (m.chapter.finale || m.toIdx <= m.fromIdx) continue;
    const old = chosen.get(m.chapter.id);
    const span = (x: MatchedChapter) => base.timeOfIdx(x.toIdx) - base.timeOfIdx(x.fromIdx);
    if (!old || span(m) > span(old)) chosen.set(m.chapter.id, m);
  }
  const groups: { from: number; to: number; read: number }[] = [];
  for (const m of [...chosen.values()].sort((a, b) => a.fromIdx - b.fromIdx)) {
    const from = base.timeOfIdx(m.fromIdx), to = base.timeOfIdx(m.toIdx);
    if (to <= from) continue;
    const read = readingSec(m.chapter) + 0.1;
    const previous = groups[groups.length - 1];
    if (previous && from <= previous.to) { previous.to = Math.max(previous.to, to); previous.read += read; }
    else groups.push({ from, to, read });
  }
  // Чтение — нижняя граница времени региона, а не добавка поверх его полного хода.
  // Любой участок без главы сохраняет не меньше 30% исходного времени.
  const minShare = 0.3;
  let reserved = 0;
  const accepted = groups.filter(g => {
    const extra = Math.max(0, g.read - (g.to - g.from) * minShare);
    if (reserved + extra > moveSec * (1 - minShare)) return false;
    reserved += extra; return true;
  });
  // Короткий ролик сохраняет только целые подписи с полным временем чтения.
  if (!reserved) return base;
  const outside = moveSec - accepted.reduce((sum, g) => sum + g.to - g.from, 0);
  let lo = minShare, hi = 1;
  for (let i = 0; i < 60; i++) {
    const share = (lo + hi) / 2;
    const used = outside * share + accepted.reduce((sum, g) => sum + Math.max((g.to - g.from) * share, g.read), 0);
    if (used > moveSec) hi = share; else lo = share;
  }
  const share = lo;
  const knots = [{ old: 0, next: 0 }];
  let extra = 0;
  for (const g of accepted) {
    if (g.from > knots[knots.length - 1].old) knots.push({ old: g.from, next: g.from * share + extra });
    extra += Math.max(0, g.read - (g.to - g.from) * share);
    knots.push({ old: g.to, next: g.to * share + extra });
  }
  if (knots[knots.length - 1].old < moveSec) knots.push({ old: moveSec, next: moveSec });
  const warp = (t: number, from: 'old' | 'next', to: 'old' | 'next'): number => {
    t = Math.max(0, Math.min(moveSec, t));
    const found = knots.findIndex((k, i) => i > 0 && k[from] >= t);
    const i = found < 0 ? knots.length - 1 : found;
    const a = knots[i - 1], b = knots[i];
    return a[to] + (b[to] - a[to]) * (t - a[from]) / (b[from] - a[from]);
  };
  return { ...base, cruiseMps: base.cruiseMps / share,
    timeOfIdx: idx => warp(base.timeOfIdx(idx), 'old', 'next'),
    headAt: tau => base.headAt(warp(tau, 'next', 'old')) };
}

/** One arrival/departure table for country exposure and chapter reading. Constraints are
 * retained when optional event cards are pruned. Repeated visits remain separate runs. */
function paceWithCountryReading(base: PacePlan, matched: MatchedChapter[], moveSec: number,
  readingSec: (chapter: Chapter) => number, budget: ReadingBudget): PacePlan {
  const count = 2 * (budget.last + 1), end = count - 1;
  const old = Float64Array.from({ length: count }, (_, i) => base.timeOfIdx(Math.floor(i / 2)));
  type Constraint = { from: number; to: number; sec: number };
  const constraints: Constraint[] = [];
  const chosen = new Set<string>();
  const chapters = matched.filter(m => {
    if (m.chapter.finale || chosen.has(m.chapter.id)) return false;
    chosen.add(m.chapter.id); return true;
  });
  for (const run of budget.runs) {
    const first = 2 * run.fromIdx;
    const last = 2 * run.toIdx + (run.fromIdx === run.toIdx ? 1 : 0);
    const inside = chapters.filter(m => m.fromIdx >= run.fromIdx && m.toIdx <= run.toIdx);
    const delay = run.fromIdx === 0 ? budget.firstDelaySec : 0;
    const read = inside.map(m => readingSec(m.chapter) + 0.1);
    // Country and chapter occupy separate zones and can be read simultaneously.
    constraints.push({ from: first, to: last, sec: Math.max(budget.labelSec, read.reduce((a, b) => a + b, 0)) + delay });
    for (let i = 0; i < inside.length; i++) {
      const m = inside[i], from = 2 * m.fromIdx;
      const to = 2 * m.toIdx + (m.fromIdx === m.toIdx ? 1 : 0);
      constraints.push({ from, to, sec: read[i] + (m.fromIdx === 0 ? delay : 0) });
      // Keep sequential chapters within their country, including shared anchors.
      constraints.push({ from, to: last, sec: read.slice(i).reduce((a, b) => a + b, 0) + (m.fromIdx === 0 ? delay : 0) });
    }
  }
  for (let i = 1; i < budget.runs.length; i++) {
    const previous = budget.runs[i - 1], next = budget.runs[i];
    constraints.push({ from: 2 * previous.toIdx + 1, to: 2 * next.fromIdx, sec: 0.35 });
  }
  // Chapters spanning country boundaries still keep their own reading interval.
  for (const m of chapters) if (!budget.runs.some(r => m.fromIdx >= r.fromIdx && m.toIdx <= r.toIdx)) {
    constraints.push({ from: 2 * m.fromIdx, to: 2 * m.toIdx + (m.fromIdx === m.toIdx ? 1 : 0), sec: readingSec(m.chapter) + 0.1 });
  }
  // Prefix constraints match scheduleChapters' max(previousEnd, arrival). They also
  // cover two chapters sharing an anchor without a positive self-edge in the graph.
  for (let j = 0; j < chapters.length; j++) {
    let read = 0;
    for (let i = j; i >= 0; i--) {
      read += readingSec(chapters[i].chapter) + 0.1;
      const from = 2 * chapters[i].fromIdx, m = chapters[j];
      const to = 2 * m.toIdx + (m.fromIdx === m.toIdx ? 1 : 0);
      constraints.push({ from, to, sec: read + (chapters[i].fromIdx === 0 ? budget.firstDelaySec : 0) });
    }
  }
  const incoming: Constraint[][] = Array.from({ length: count }, () => []);
  const outgoing: Constraint[][] = Array.from({ length: count }, () => []);
  for (let i = 1; i < count; i++) constraints.push({ from: i - 1, to: i, sec: 0 });
  for (const c of constraints) { incoming[c.to].push(c); outgoing[c.from].push(c); }
  const solve = (share: number): Float64Array => {
    const times = new Float64Array(count);
    for (let i = 1; i < count; i++) {
      times[i] = times[i - 1] + (old[i] - old[i - 1]) * share;
      for (const c of incoming[i]) times[i] = Math.max(times[i], times[c.from] + c.sec);
    }
    return times;
  };
  // Unlike the legacy chapter-only warp, country reservations cover essentially
  // the whole route. A blanket 30% of every original flight would double-reserve
  // the budget. Flights keep an explicit minimum; all other motion keeps 5%.
  const minimumShare = 0.05;
  const minimum = solve(minimumShare);
  budget.result = { feasible: minimum[end] <= moveSec + 1e-9, requiredSec: minimum[end], availableSec: moveSec };
  if (!budget.result.feasible) return base;
  let lo = minimumShare, hi = 1;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (solve(mid)[end] > moveSec) hi = mid; else lo = mid;
  }
  const times = solve(lo); times[end] = moveSec;
  const preferred = Float64Array.from(times);
  for (const r of budget.runs) {
    const from = 2 * r.fromIdx, to = 2 * r.toIdx;
    const weight = (i: number) => budget.positionWeights?.[Math.floor(i / 2)] ?? old[i];
    const span = weight(to) - weight(from);
    if (to <= from || !(span > 0)) continue;
    for (let i = from + 1; i < to; i++) preferred[i] = times[from] + (times[to] - times[from]) * (weight(i) - weight(from)) / span;
  }
  // Relax toward the preferred base distribution, keeping every lower bound and endpoints.
  for (let pass = 0; pass < 64; pass++) for (let k = 1; k < end; k++) {
    const i = pass % 2 ? end - k : k;
    let lower = times[i - 1] + (old[i] - old[i - 1]) * lo;
    let upper = times[i + 1] - (old[i + 1] - old[i]) * lo;
    for (const c of incoming[i]) lower = Math.max(lower, times[c.from] + c.sec);
    for (const c of outgoing[i]) upper = Math.min(upper, times[c.to] - c.sec);
    times[i] = Math.max(lower, Math.min(upper, preferred[i]));
  }
  // Keep every reading boundary pinned, but spend the first country's slack on
  // travel between those boundaries. Coordinate relaxation can otherwise leave
  // a departure behind at a chapter's arrival, interrupting the opening motion.
  const firstRun = budget.runs.find(r => r.fromIdx === 0 && r.toIdx > 0);
  if (firstRun) {
    const to = 2 * firstRun.toIdx;
    const anchors = [...new Set([0, to, ...constraints.filter(c => c.sec > 0)
      .flatMap(c => [c.from, c.to]).filter(i => i > 0 && i < to)])].sort((a, b) => a - b);
    const weight = (i: number) => budget.positionWeights?.[Math.floor(i / 2)] ?? old[i];
    for (let k = 1; k < anchors.length; k++) {
      const a = anchors[k - 1], b = anchors[k], span = weight(b) - weight(a);
      if (!(span > 0)) continue; // A single-mark chapter retains its reading hold.
      const slack = Math.max(0, times[b] - times[a] - (old[b] - old[a]) * lo);
      for (let i = a + 1; i < b; i++) times[i] = times[a] + (old[i] - old[a]) * lo
        + slack * (weight(i) - weight(a)) / span;
    }
  }
  const speeds = Float64Array.from({ length: budget.last }, (_, i) => 1 / Math.max(1e-12, times[2 * i + 2] - times[2 * i + 1]));
  const tangents = Float64Array.from({ length: budget.last + 1 }, (_, i) => {
    if (i === 0 || i === budget.last || times[2 * i + 1] > times[2 * i] + 1e-9) return 0;
    return 2 * speeds[i - 1] * speeds[i] / (speeds[i - 1] + speeds[i]);
  });
  return { moveSec, cruiseMps: base.cruiseMps / lo,
    timeOfIdx: idx => times[2 * Math.max(0, Math.min(budget.last, Math.round(idx)))],
    departureOfIdx: idx => times[2 * Math.max(0, Math.min(budget.last, Math.round(idx))) + 1],
    headAt(tau) {
      if (!(tau > 0)) return 0;
      if (tau >= moveSec) return budget.last;
      let l = 0, h = end;
      while (h - l > 1) { const m = (l + h) >> 1; if (times[m] <= tau) l = m; else h = m; }
      if (l % 2 === 0) return l / 2;
      // Monotone Hermite interpolation preserves every pinned arrival. In particular,
      // reserving a country must not stretch the base's global 0.6 s start ramp.
      const a = Math.floor(l / 2), span = times[h] - times[l];
      const u = (tau - times[l]) / Math.max(1e-12, span), u2 = u * u, u3 = u2 * u;
      return a + (-2 * u3 + 3 * u2) + (u3 - 2 * u2 + u) * span * tangents[a]
        + (u3 - u2) * span * tangents[a + 1];
    } };
}

/** Переходы сохраняют текущее смешение, даже если новая глава начинается раньше конца предыдущего перехода. */
export function chapterMoodAt(matched: MatchedChapter[], last: number, timeOfIdx: (idx: number) => number, journeyEnd: number, captions: { at: number; mood: ChapterMood }[] = []): (t: number) => ChapterMoodState {
  const empty = (): ChapterMoodState['weights'] => ({ cold: 0, heat: 0, rain: 0, altitude: 0, warmth: 0, neutral: 1 });
  const transitions: { at: number; from: ChapterMoodState['weights']; to: ChapterMood }[] = [];
  const at = (t: number): ChapterMoodState => {
    const change = [...transitions].reverse().find((c) => c.at <= t);
    if (!change) return { weights: empty() };
    const x = Math.max(0, Math.min(1, (t - change.at) / 0.75)), k = x * x * (3 - 2 * x);
    const weights = empty();
    for (const mood of Object.keys(weights) as ChapterMood[]) weights[mood] = change.from[mood] * (1 - k) + (mood === change.to ? k : 0);
    return { weights };
  };
  const changes: { at: number; mood: ChapterMood }[] = [];
  let previous: ChapterMood = 'neutral';
  for (let i = 0; i <= last; i++) {
    const mood = matched.find((m) => !m.chapter.finale && i >= m.fromIdx && i <= m.toIdx)?.chapter.mood ?? 'neutral';
    if (mood === previous) continue;
    const time = timeOfIdx(i);
    changes.push({ at: time, mood }); previous = mood;
  }
  const final = matched.find((m) => m.chapter.finale);
  if (final) changes.push({ at: journeyEnd, mood: final.chapter.mood });
  changes.push(...captions);
  previous = 'neutral';
  for (const change of changes.sort((a, b) => a.at - b.at)) {
    if (change.mood === previous) continue;
    transitions.push({ at: change.at, from: at(change.at).weights, to: change.mood });
    previous = change.mood;
  }
  return at;
}

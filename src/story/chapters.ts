import type { Chapter, ChapterMood, ChapterMoodState, Enrichment, Route } from '../types';
import type { PacePlan } from './pace';
export interface MatchedChapter { chapter: Chapter; fromIdx: number; toIdx: number }
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
export function paceWithChapterReading(base: PacePlan, matched: MatchedChapter[], moveSec: number, readingSec: (chapter: Chapter) => number): PacePlan {
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
  let reserved = 0;
  const accepted = groups.filter(g => {
    if (reserved + g.read >= moveSec * 0.9) return false;
    reserved += g.read; return true;
  });
  // Короткий ролик сохраняет только целые подписи с полным временем чтения.
  if (!reserved) return base;
  const share = (moveSec - reserved) / moveSec;
  const knots = [{ old: 0, next: 0 }];
  let extra = 0;
  for (const g of accepted) {
    if (g.from > knots[knots.length - 1].old) knots.push({ old: g.from, next: g.from * share + extra });
    extra += g.read;
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

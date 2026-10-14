// Read-only полоса актов под сценой (история 132): вступление / путь / финал.
// Границы не берутся из таблицы, а находятся по настоящему Timeline (`frameAt(t).act`) — полоса не разойдётся с роликом.
import type { FrameState } from '../../types';

export type ActId = FrameState['act'];
export interface ActSegment { id: ActId; label: string; start: number; end: number }
export interface ActsSource { durationSec: number; frameAt(t: number): Pick<FrameState, 'act'> }

const ORDER: ActId[] = ['intro', 'journey', 'outro'];
export const ACT_LABELS: Record<ActId, string> = { intro: 'Вступление', journey: 'Путь', outro: 'Финал' };

/** Первое t в [0, duration], где акт уже не `before` (акты идут строго по порядку, поэтому делим пополам). */
function boundary(src: ActsSource, before: ActId[]): number {
  let lo = 0;
  let hi = src.durationSec;
  if (before.includes(src.frameAt(hi).act)) return hi;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (before.includes(src.frameAt(mid).act)) lo = mid; else hi = mid;
  }
  return Math.round(hi * 100) / 100;
}

export function actSegmentsOf(src: ActsSource): ActSegment[] {
  const introEnd = boundary(src, ['intro']);
  const journeyEnd = boundary(src, ['intro', 'journey']);
  const edges = [0, introEnd, journeyEnd, src.durationSec];
  return ORDER
    .map((id, i) => ({ id, label: ACT_LABELS[id], start: edges[i], end: edges[i + 1] }))
    .filter((s) => s.end - s.start > 0.001);
}

/** Куда прыгает просмотр по клику на акт: к его началу. */
export function seekTimeFor(segments: ActSegment[], id: ActId): number {
  return segments.find((s) => s.id === id)?.start ?? 0;
}

/** Доля акта, пройденная к моменту t (0…1). */
export function actFill(seg: ActSegment, t: number): number {
  const len = seg.end - seg.start;
  return len <= 0 ? 0 : Math.min(1, Math.max(0, (t - seg.start) / len));
}

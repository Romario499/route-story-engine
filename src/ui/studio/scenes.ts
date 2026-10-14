import type { FrameState, Lang } from '../../types';
import { ACT_LABELS, actSegmentsOf } from './acts';

export interface SceneSegment { id: string; kind: string; label: string; start: number; end: number; sampleAt: number }
export interface ScenesSource { durationSec: number; frameAt(t: number): Pick<FrameState, 'act' | 'cards'> }

/** Считываем показанные карточки из готового таймлайна. Не выводим события из порядка стран или закладок. */
export function sceneSegmentsOf(source: ScenesSource, lang: Lang): SceneSegment[] {
  const scenes: SceneSegment[] = actSegmentsOf(source).map(act => ({
    ...act, kind: act.id, label: ACT_LABELS[act.id], sampleAt: Math.min(act.end - 0.1, act.start + 0.8),
  }));
  const seen = new Map<string, SceneSegment>();
  for (let tick = 0; tick <= Math.ceil(source.durationSec * 10); tick++) {
    const at = Math.min(tick / 10, source.durationSec);
    const frame = source.frameAt(at);
    if (frame.act !== 'journey') continue;
    for (const card of frame.cards) {
      if (card.alpha <= 0) continue;
      const kind = card.chapter ? 'chapter' : card.transport ? 'transport' : card.beat.kind;
      if (!['chapter', 'transport', 'country'].includes(kind)) continue;
      const id = `${kind}-${card.chapter?.id ?? card.transport?.fromIdx ?? card.beat.idx}`;
      const existing = seen.get(id);
      if (existing) { existing.sampleAt = (existing.start + at) / 2; continue; }
      const label = card.chapter?.title[lang] ?? (card.transport
        ? card.transport.kind === 'train' ? 'Поезд' : card.transport.kind === 'unicycle' ? 'Моноколесо · расчётно' : 'Смена участка'
        : lang === 'ru' ? card.beat.country?.nameRu : card.beat.country?.nameEn);
      if (!label) continue;
      const scene = { id, kind, label, start: at, end: at, sampleAt: at };
      scenes.push(scene);
      seen.set(id, scene);
    }
  }
  scenes.sort((a, b) => a.start - b.start);
  scenes.forEach((scene, i) => { scene.end = scenes[i + 1]?.start ?? source.durationSec; });
  return scenes;
}

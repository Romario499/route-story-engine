import { expect, it } from 'vitest';
import type { FrameState } from '../../src/types';
import { sceneSegmentsOf } from '../../src/ui/studio/scenes';

it('сцены отражают только реальные карточки таймлайна, включая повтор страны и главу', () => {
  const source = { durationSec: 10, frameAt(t: number) {
    const country = { iso2: 'TR', nameRu: 'Турция', nameEn: 'Turkey' };
    return { act: t < 1 ? 'intro' : t < 9 ? 'journey' : 'outro', cards:
      t >= 2 && t < 3 ? [{ beat: { kind: 'country', idx: 2, country }, alpha: 1 }]
      : t >= 5 && t < 6 ? [{ beat: { kind: 'country', idx: 8, country }, alpha: 1 }]
      : t >= 7 && t < 8 ? [{ beat: { kind: 'waypoint', idx: 9 }, chapter: { id: 'test', title: { ru: 'Перевал', en: 'Pass' } }, alpha: 1 }] : [],
    } as FrameState;
  } };
  const scenes = sceneSegmentsOf(source, 'ru');
  expect(scenes.map(s => s.label)).toEqual(['Вступление', 'Путь', 'Турция', 'Турция', 'Перевал', 'Финал']);
  expect(scenes.map(s => s.start)).toEqual([0, 1, 2, 5, 7, 9]);
  expect(sceneSegmentsOf({ ...source, frameAt: t => ({ ...source.frameAt(t), cards: [] }) }, 'ru').map(s => s.kind)).toEqual(['intro', 'journey', 'outro']);
});

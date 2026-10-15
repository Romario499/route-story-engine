import { expect, it } from 'vitest';
import { buildTimeline, READ_MIN_SEC } from '../../src/story';
import type { Chapter } from '../../src/types';
import { enrichmentFor, lineRoute, settings } from './fixtures';
import { jw, confirmedWaypointRoute as waypointRoute, D0, DAY } from './waypoint-fixtures';
export const storyChapter: Chapter = { id: 'fiction', title: { ru: 'Вымышленная глава', en: 'Fictional chapter' }, text: { ru: 'Вымышленное воспоминание.', en: 'A fictional memory.' }, source: 'traveler', mood: 'rain', anchor: { countries: ['GE'], markedAt: { from: D0, to: D0 + 4 * DAY }, region: { name: 'Synthetic region', bbox: [29,39,33,41] } } };
it('главы совпадают со страной, регионом и временем меток, читаются и не меняют движение; seek детерминирован', () => {
  const route = waypointRoute(Array.from({ length: 12 }, (_, i) => jw(40, 30 + i * 0.3, 'stop', i)));
  const env = enrichmentFor(route);
  const cfg = settings();
  const baseline = buildTimeline(route, env, cfg);
  const wrong = { ...storyChapter, id: 'wrong', anchor: { ...storyChapter.anchor, countries: ['ZZ'] } };
  const finale = { ...storyChapter, id: 'final', finale: true };
  const tl = buildTimeline({ ...route, chapters: [wrong, storyChapter, finale] }, env, cfg);
  const frames = Array.from({ length: 901 }, (_, i) => tl.frameAt(i / 30));
  const shown = frames.filter(f => f.cards[0]?.chapter?.id === 'fiction');
  expect(shown.length).toBeGreaterThan(0);
  expect(shown.filter(f => f.cards[0].alpha >= 0.999).length / 30).toBeGreaterThanOrEqual(READ_MIN_SEC);
  expect(frames.every(f => f.cards.length <= 1 && f.cards[0]?.chapter?.id !== 'wrong')).toBe(true);
  expect(tl.frameAt(30).finalChapter?.id).toBe('final');
  for (const f of [...frames].reverse()) { expect(tl.frameAt(f.t)).toEqual(f); const old = baseline.frameAt(f.t); expect(f.head).toBe(old.head); }
  for (const anchor of [{ countries: ['GE'], region: { name: 'elsewhere', bbox: [0,0,1,1] as [number,number,number,number] } }, { countries: ['GE'], markedAt: { from: 1, to: 2 } }]) {
    const absent = buildTimeline({ ...route, chapters: [{ ...storyChapter, anchor }] }, env, cfg);
    for (let t = 0; t <= 30; t += 0.25) expect(absent.frameAt(t)).toEqual(baseline.frameAt(t));
  }
  const compact = waypointRoute(Array.from({length:30},(_,i)=>jw(40,i<6?30+i*0.002:50+(i-6)*2,'overnight',i)));
  const compactEnv = enrichmentFor(compact,{border:3});
  const compactChapters: Chapter[] = [
    {...storyChapter,anchor:{countries:['GE']}},
    {...storyChapter,id:'second',anchor:{countries:['AM'],region:{name:'Synthetic area',bbox:[29,39,31,41]}}},
  ];
  const compactTimeline=buildTimeline({...compact,chapters:compactChapters},compactEnv,settings({durationSec:60}));
  const compactSeen=new Set(Array.from({length:1801},(_,i)=>compactTimeline.frameAt(i/30).cards[0]?.chapter?.id).filter(Boolean));
  expect(compactSeen).toEqual(new Set(['fiction','second']));
  const gps = lineRoute(20), ge = enrichmentFor(gps);
  for (let t = 0; t <= 30; t += 0.25) expect(buildTimeline({ ...gps, chapters: [storyChapter] }, ge, cfg).frameAt(t)).toEqual(buildTimeline(gps, ge, cfg).frameAt(t));
});

it('шесть коротких регионов полного пути получают время чтения без остановки движения', () => {
  const route = waypointRoute(Array.from({ length: 100 }, (_, i) => jw(40, i < 24 ? 30 + i * 0.002 : 50 + (i - 24) * 0.6, 'overnight', i)));
  const env = enrichmentFor(route, { border: 100 });
  route.chapters = Array.from({ length: 6 }, (_, i) => ({ ...storyChapter, id: `fiction-${i}`, anchor: { countries: ['GE'], markedAt: { from: D0 + i * 4 * DAY, to: D0 + (i * 4 + 3) * DAY } } }));
  const tl = buildTimeline(route, env, settings({ durationSec: 60 }));
  const frames = Array.from({ length: 1801 }, (_, i) => tl.frameAt(i / 30));
  for (const c of route.chapters) {
    const shown = frames.filter(f => f.cards[0]?.chapter?.id === c.id && f.cards[0].alpha >= 0.999);
    expect(shown.length / 30, c.id).toBeGreaterThanOrEqual(READ_MIN_SEC);
    expect(shown.every((f, i) => i === 0 || f.head > shown[i - 1].head || f.head === 0)).toBe(true);
  }
  for (const f of frames.slice().reverse()) expect(tl.frameAt(f.t)).toEqual(f);
});

// Участки маршрута по меткам (истории 140, 142): вид передвижения и честные показатели — на синтетике.
import { describe, expect, it } from 'vitest';
import { buildLegs, factsAt, journeyFacts, runsOf, waypointPacingRoute } from '../../src/story/legs';
import { jw, syntheticJourney, waypointRoute } from './waypoint-fixtures';
import { lineRoute } from './fixtures';

const kinds = (route: ReturnType<typeof waypointRoute>) => buildLegs(route).map((l) => l.kind);

describe('участки по меткам (история 140)', () => {
  it('конец участка — жёлтая метка: train, подтверждено словами владельца', () => {
    const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 33, 'train', 1), jw(40, 36, 'train', 2), jw(40, 36.2, 'overnight', 3)]);
    const legs = buildLegs(route);
    expect(legs.map((l) => l.kind)).toEqual(['train', 'train', 'train']);
    expect(legs.every((l) => l.confidence === 'stated')).toBe(true);
  });

  it('между ночёвками с шагом ≤ 120 км/сутки — unicycle, и только предположительно (inferred)', () => {
    // 0,35° по долготе на 40° с. ш. ≈ 30 км за сутки
    const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 30.35, 'overnight', 1), jw(40, 30.7, 'overnight', 2)]);
    const legs = buildLegs(route);
    expect(legs.map((l) => l.kind)).toEqual(['unknown', 'unknown']);
    expect(legs.every((l) => l.confidence === 'unknown')).toBe(true);
    expect(legs[0].straightKm).toBeGreaterThan(28);
    expect(legs[0].straightKm).toBeLessThan(32);
  });

  it('те же ~500 км за 2 суток между ночёвками — больше 120 км/сутки, значит unknown', () => {
    const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 35.9, 'overnight', 2)]); // ≈ 500 км
    expect(kinds(route)).toEqual(['unknown']);
  });

  it('закладки пачкой (разница меньше суток) считаются за сутки: 50 км — unicycle, 200 км — unknown', () => {
    const near = waypointRoute([jw(40, 30, 'overnight', 5), jw(40, 30.59, 'overnight', 5)]); // ≈ 50 км
    const far = waypointRoute([jw(40, 30, 'overnight', 5), jw(40, 32.35, 'overnight', 5)]); // ≈ 200 км
    expect(kinds(near)).toEqual(['unknown']);
    expect(kinds(far)).toEqual(['unknown']);
  });

  it('красная остановка или метка без времени на конце — unknown, а не догадка', () => {
    const withStop = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 30.1, 'stop', 1), jw(40, 30.4, 'overnight', 2)]);
    expect(kinds(withStop)).toEqual(['unknown', 'unknown']);
    const noTime = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 30.3, 'overnight')]);
    expect(kinds(noTime)).toEqual(['unknown']);
  });

  it('порог км/сутки задаётся параметром', () => {
    const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 30.35, 'overnight', 1)]); // ≈ 30 км
    expect(buildLegs(route, { maxKmPerDay: 20 }).map((l) => l.kind)).toEqual(['unknown']);
    expect(buildLegs(route, { maxKmPerDay: 40 }).map((l) => l.kind)).toEqual(['unknown']);
  });

  it('синтетическая поездка: 39 унициклов, скачок unknown, 6 поездов, дальше унициклы и остановки unknown', () => {
    const route = waypointRoute(syntheticJourney());
    const legs = buildLegs(route);
    expect(legs).toHaveLength(route.points.length - 1);
    expect(legs.slice(0, 39).every((l) => l.kind === 'unknown')).toBe(true);
    expect(legs[39].kind).toBe('unknown');
    expect(legs.slice(40, 46).every((l) => l.kind === 'train')).toBe(true);
    // красная остановка после пятой ночёвки второй цепочки: оба участка вокруг неё unknown
    const stopIdx = route.journeyWaypoints!.findIndex((m) => m.kind === 'stop');
    expect(legs[stopIdx - 1].kind).toBe('unknown');
    expect(legs[stopIdx].kind).toBe('unknown');
    // диапазоны участков хранятся индексами меток — по ним потом можно вырезать участок (история 151)
    expect(legs.every((l, i) => l.fromIdx === i && l.toIdx === i + 1)).toBe(true);
  });

  it('серии: подряд идущие участки одного вида сливаются, число участков в серии считается', () => {
    const route = waypointRoute(syntheticJourney());
    const runs = runsOf(buildLegs(route));
    expect(runs.slice(0, 3).map((r) => [r.kind, r.legCount])).toEqual([['unknown', 40], ['train', 6], ['unknown', 23]]);
    expect(runs[0]).toMatchObject({ fromIdx: 0, toIdx: 40 });
    expect(runs[1]).toMatchObject({ fromIdx: 40, toIdx: 46 });
  });
});

describe('показатели по меткам (история 142)', () => {
  it('пять ночёвочных закладок одних местных суток — одна ночь; местная полночь задаёт дни, без времени ночи неизвестны', () => {
    // 21:00–21:40 UTC и 00:20 UTC следующей даты при lon=45: всё приходится на 2 июня местного солнечного пояса UTC+3.
    const marks = [0, 10, 20, 30, 40].map((minutes, i) => ({
      ...jw(40 + i * 0.01, 45, 'overnight'), markedAt: Date.UTC(2025, 5, 1, 21, minutes),
    }));
    const same = journeyFacts(waypointRoute(marks))!;
    expect(same.nightsTotal).toBe(5);
    expect(Array.from(same.nights)).toEqual([1, 2, 3, 4, 5]);
    expect(same.days).toBeUndefined();
    const crossingUtc = journeyFacts(waypointRoute([...marks, {
      ...jw(40.1, 45, 'overnight'), markedAt: Date.UTC(2025, 5, 2, 0, 20),
    }, jw(40.2, 45, 'overnight')]))!;
    expect(crossingUtc.nightsTotal).toBe(7);
    expect(crossingUtc.days).toBeUndefined();
    expect(factsAt(crossingUtc, 6)).toMatchObject({ nights: 7, day: undefined });
    const localMidnight = journeyFacts(waypointRoute([
      { ...jw(40, 45, 'overnight'), markedAt: Date.UTC(2025, 5, 1, 20, 50) },
      { ...jw(40.1, 45, 'overnight'), markedAt: Date.UTC(2025, 5, 1, 21, 10) },
    ]))!;
    expect(localMidnight.nightsTotal).toBe(2);
    expect(localMidnight.days).toBeUndefined();
    expect(localMidnight.markDays).toBeUndefined();
    const untimed = journeyFacts(waypointRoute([jw(40, 45, 'overnight'), jw(40.1, 45, 'overnight')]))!;
    expect(untimed.nightsTotal).toBe(2);
    expect(untimed.days).toBeUndefined();
  });

  it('ночёвки, дни по меткам и км по прямой — только то, что известно из меток', () => {
    const route = waypointRoute(syntheticJourney());
    const facts = journeyFacts(route)!;
    expect(facts.nightsTotal).toBe(40 + 1 + 20);
    // первая закладка в день 0, последняя поставлена на сутки позже последней ночёвки: 41 + 5 + 20 → день 66
    expect(facts.days).toBeUndefined();
    expect(facts.straightTotalKm).toBeGreaterThan(2100); // один скачок на 25° уже ≈ 2 000 км
    expect(route.totalM).toBe(0); // километража трека в маршруте по меткам нет
  });

  it('factsAt: ночёвки — целые пройденные, км по прямой нарастают плавно, день не убывает', () => {
    const route = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 31, 'overnight', 1), jw(40, 32, 'stop', 1), jw(40, 33, 'overnight', 3)]);
    const facts = journeyFacts(route)!;
    expect(factsAt(facts, 0)).toMatchObject({ nights: 1, day: undefined, straightKm: 0 });
    const half = factsAt(facts, 0.5);
    expect(half.nights).toBe(1);
    expect(half.straightKm).toBeCloseTo(facts.legs[0].straightKm / 2, 6);
    expect(factsAt(facts, 2.9)).toMatchObject({ nights: 2, day: undefined });
    expect(factsAt(facts, 3)).toMatchObject({ nights: 3, day: undefined });
  });

  it('без времени закладок дней по меткам нет, а не выдуманные', () => {
    const route = waypointRoute([jw(40, 30, 'overnight'), jw(40, 31, 'overnight'), jw(40, 32, 'overnight')]);
    const facts = journeyFacts(route)!;
    expect(facts.days).toBeUndefined();
    expect(factsAt(facts, 1).day).toBeUndefined();
  });

  it('для обычного GPS-маршрута фактов по меткам нет', () => {
    expect(journeyFacts(lineRoute(50))).toBeNull();
  });
});

describe('маршрут для темпа и камеры', () => {
  const route = waypointRoute(syntheticJourney());
  const facts = journeyFacts(route)!;

  it('км в d — по прямой; без порога переездов нет; исходный маршрут не тронут', () => {
    const pacing = waypointPacingRoute(route, facts);
    expect(pacing.points[pacing.points.length - 1].d / 1000).toBeCloseTo(facts.straightTotalKm, 6);
    expect(pacing.totalM).toBeCloseTo(facts.straightTotalKm * 1000, 3);
    expect(pacing.transfers).toHaveLength(0);
    expect(route.points[5].d).toBe(0);
    expect(route.totalM).toBe(0);
  });

  it('скачки длиннее порога идут как переезды: 1 000 км — только скачок на ≈ 2 000 км, 200 км — ещё и поезд по ≈ 250 км', () => {
    const flagged = (limitKm: number) => waypointPacingRoute(route, facts, limitKm).points.flatMap((p, i) => (p.transferBefore ? [i] : []));
    expect(flagged(1000)).toEqual([40]);
    expect(flagged(200)).toEqual([40, 41, 42, 43, 44, 45]);
    expect(waypointPacingRoute(route, facts, 200).transfers).toHaveLength(6);
    // свой ход — только участки короче порога
    const pacing = waypointPacingRoute(route, facts, 1000);
    expect(pacing.ownM / 1000).toBeCloseTo(facts.straightTotalKm - facts.legs[39].straightKm, 6);
  });
});

it('отчёт импорта содержит таблицу серий: виды, индексы, число меток и консервативное подтверждение', () => {
  const marks = [jw(40, 30, 'overnight', 0), jw(40, 30.35, 'overnight', 1),
    jw(40, 31, 'train', 2), jw(40, 32, 'train', 3), jw(40, 33, 'overnight', 4), jw(40, 34, 'stop', 5)];
  // У второй поездной метки семантика не подтверждена: вся серия не может быть stated.
  marks[3].confidence = 'unknown';
  expect(waypointRoute(marks).importReport).toMatchObject({ legs: [
    { kind: 'unknown', fromIdx: 0, toIdx: 1, waypointCount: 2, confidence: 'unknown' },
    { kind: 'train', fromIdx: 1, toIdx: 4, waypointCount: 4, confidence: 'inferred' },
    { kind: 'unknown', fromIdx: 4, toIdx: 5, waypointCount: 2, confidence: 'unknown' },
  ] });
});

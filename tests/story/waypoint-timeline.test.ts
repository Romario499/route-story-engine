// История маршрута по меткам (истории 141–142): голова идёт по меткам с той же непрерывной камерой, смена транспорта —
// событие в слоте (одна подпись), показатели — без километража трека, скорости и высоты. Синтетика.
import { describe, expect, it } from 'vitest';
import { timelineOptionsFor } from '../../src/render/layout';
import { buildTimeline } from '../../src/story';
import { journeyFacts } from '../../src/story/legs';
import { FPS, type FrameState } from '../../src/types';
import { enrichmentFor, settings } from './fixtures';
import { jw, syntheticJourney, confirmedWaypointRoute as waypointRoute } from './waypoint-fixtures';

const route = waypointRoute(syntheticJourney());
// граница стран — далеко от поезда (метка 40), иначе карточка страны занимает слот и подпись смены уступает
const enrichment = enrichmentFor(route, { border: 12 });
const facts = journeyFacts(route)!;
const frames = (d: 15 | 30 | 60 = 30, format: '9:16' | '16:9' = '9:16') => {
  const tl = buildTimeline(route, enrichment, settings({ durationSec: d, format }), timelineOptionsFor(format));
  return Array.from({ length: tl.frameCount + 1 }, (_, i) => tl.frameAt(i / FPS));
};

const mx = (lon: number) => lon / 360 + 0.5;
const my = (lat: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

describe('маршрут по меткам — голова и камера', () => {
  it('голова не убывает, проходит все метки и доходит до последней до начала финала', () => {
    const fs = frames();
    for (let i = 1; i < fs.length; i++) expect(fs[i].head).toBeGreaterThanOrEqual(fs[i - 1].head - 1e-9);
    const last = route.points.length - 1;
    const atOutro = fs.find((f) => f.act === 'outro')!;
    expect(atOutro.head).toBe(last);
    expect(fs.find((f) => f.act === 'journey')!.head).toBeLessThan(1);
  });

  it('камера движется вместе с головой: центр кадра сдвигается от старта к финишу, а не стоит на месте', () => {
    const fs = frames().filter((f) => f.act === 'journey');
    const at = (head: number) => fs.find((f) => f.head >= head)!.camera.center[0];
    // метки идут на восток: 8-я метка ≈ 33°, 41-я — после скачка на 25° ≈ 69°, 60-я — ≈ 87°
    expect(at(41)).toBeGreaterThan(at(8) + 10);
    expect(at(60)).toBeGreaterThan(at(41) + 5);
    // голова не уходит из окна камеры: центр кадра отстаёт от головы не больше чем на десяток градусов
    for (const f of fs.filter((x) => x.head > 8)) expect(Math.abs(f.camera.center[0] - f.headLonLat[0])).toBeLessThan(30);
  });

  for (const [d, format] of [[15, '9:16'], [30, '9:16'], [30, '16:9'], [60, '16:9']] as const) {
    it(`${d} с, ${format}: шаг zoom, ускорение zoom и шаг центра между кадрами ограничены (скачок на тысячи км и поезд — без рывков)`, () => {
      const fs = frames(d, format);
      let prevDz = 0;
      for (let i = 1; i < fs.length; i++) {
        const a = fs[i - 1].camera, b = fs[i].camera;
        const dz = Math.abs(b.zoom - a.zoom);
        expect(dz, `кадр ${i}: шаг zoom`).toBeLessThanOrEqual(0.12);
        expect(Math.abs(dz - prevDz), `кадр ${i}: ускорение zoom`).toBeLessThanOrEqual(0.008);
        prevDz = dz;
        const world = 512 * 2 ** Math.max(a.zoom, b.zoom);
        const px = Math.hypot((mx(b.center[0]) - mx(a.center[0])) * world, (my(b.center[1]) - my(a.center[1])) * world);
        expect(px, `кадр ${i}: шаг центра`).toBeLessThanOrEqual(40);
      }
    });
  }

  it('голова лежит между соседними метками (на отрезке), а не вне их рамки', () => {
    const marks = route.journeyWaypoints!;
    const pad = 1e-6;
    for (const f of frames().filter((x) => x.act === 'journey')) {
      const i = Math.min(marks.length - 2, Math.floor(f.head));
      const a = marks[i], b = marks[i + 1];
      expect(f.headLonLat[0]).toBeGreaterThanOrEqual(Math.min(a.lon, b.lon) - pad);
      expect(f.headLonLat[0]).toBeLessThanOrEqual(Math.max(a.lon, b.lon) + pad);
      expect(f.headLonLat[1]).toBeGreaterThanOrEqual(Math.min(a.lat, b.lat) - pad);
      expect(f.headLonLat[1]).toBeLessThanOrEqual(Math.max(a.lat, b.lat) + pad);
    }
  });
});

describe('маршрут по меткам — показатели без выдуманных цифр (история 142)', () => {
  it('«по прямой» нарастает до суммы отрезков, прогресс — доля пройденных меток, дата/день/скорость/высота не заполняются', () => {
    const fs = frames();
    const last = route.points.length - 1;
    for (const f of fs.filter((x) => x.act === 'journey')) {
      expect(f.stats.distanceKm).toBeCloseTo(facts.straightKm[Math.floor(f.head)] + (facts.straightKm[Math.min(last, Math.floor(f.head) + 1)] - facts.straightKm[Math.floor(f.head)]) * (f.head - Math.floor(f.head)), 6);
      expect(f.stats.progress).toBeCloseTo(f.head / last, 9);
      expect(f.stats.day).toBeUndefined();
      expect(f.stats.date).toBeUndefined();
      expect(f.stats.speedKmh).toBeUndefined();
      expect(f.stats.altitudeM).toBeUndefined();
    }
    const end = fs[fs.length - 1];
    expect(end.stats.distanceKm).toBeCloseTo(facts.straightTotalKm, 6);
    expect(end.stats.progress).toBe(1);
  });
});

describe('маршрут по меткам — смена транспорта как событие слота (история 141)', () => {
  const fs = frames();
  const withTransport = fs.filter((f) => f.cards.some((c) => c.transport));

  it('поезд объявлен одной подписью, когда голова входит в серию участков поезда', () => {
    const train = withTransport.filter((f) => f.cards[0].transport!.kind === 'train');
    expect(train.length).toBeGreaterThan(0);
    const firstFrame = train[0];
    // серия поезда начинается с метки 40 (ночёвка → первая жёлтая)
    expect(firstFrame.cards[0].transport).toMatchObject({ kind: 'train', fromIdx: 40, toIdx: 46, confidence: 'stated' });
    expect(firstFrame.head).toBeGreaterThan(40 - 2.5);
    expect(firstFrame.head).toBeLessThan(40 + 1);
    // полная яркость и появление/гашение — как у остальных карточек слота
    expect(Math.max(...train.map((f) => f.cards[0].alpha))).toBe(1);
  });

  it('смена на «способ неизвестен» тоже подпись, но первая серия (старт) подписи смены не получает', () => {
    for (const f of withTransport) expect(f.cards[0].transport!.fromIdx).toBeGreaterThan(0);
    for (const f of withTransport) expect(f.cards[0].beat.kind).toBe('waypoint');
  });

  it('всегда не больше одной карточки; подписи смены не пересекаются с другими по времени', () => {
    for (const f of fs) expect(f.cards.length).toBeLessThanOrEqual(1);
    const kinds = new Set(fs.flatMap((f) => f.cards.map((c) => (c.transport ? 'transport' : c.beat.kind))));
    expect(kinds.has('transport')).toBe(true);
    expect(kinds.has('start')).toBe(true);
  });

  it('названия меток не попадают в ролик: карточек остановок по меткам нет', () => {
    const named = enrichmentFor(route, { extraBeats: [{ kind: 'waypoint', idx: 10, label: 'Секретная точка' }, { kind: 'peak', idx: 12, ele: 3000 }] });
    const tl = buildTimeline(route, named, settings(), timelineOptionsFor('9:16'));
    for (let i = 0; i <= tl.frameCount; i++) {
      for (const c of tl.frameAt(i / FPS).cards) {
        expect(c.beat.label ?? '').not.toContain('Секретная');
        expect(c.beat.kind).not.toBe('peak');
      }
    }
  });

  it('маршрут из двух меток и без смен транспорта собирается без падений: подписей смены нет', () => {
    const tiny = waypointRoute([jw(40, 30, 'overnight', 0), jw(40, 30.3, 'overnight', 1)]);
    const tl = buildTimeline(tiny, enrichmentFor(tiny, { border: 1 }), settings(), timelineOptionsFor('9:16'));
    let seen = 0;
    for (let i = 0; i <= tl.frameCount; i++) seen += tl.frameAt(i / FPS).cards.filter((c) => c.transport).length;
    expect(seen).toBe(0);
  });
});

describe('детерминизм (история 133)', () => {
  it('кадр после перемотки совпадает с кадром последовательного прохода', () => {
    const tlA = buildTimeline(route, enrichment, settings(), timelineOptionsFor('9:16'));
    const ts = [1, 2.5, 4.4, 9.9, 13.37, 18, 22.2, 27.1, 29.9];
    const jumped = ts.map((t) => tlA.frameAt(t));
    const tlB = buildTimeline(route, enrichment, settings(), timelineOptionsFor('9:16'));
    for (let i = 0; i <= tlB.frameCount; i++) tlB.frameAt(i / FPS);
    ts.forEach((t, k) => expect(tlB.frameAt(t)).toEqual(jumped[k]));
  });
});

type _Frame = FrameState; // тип нужен только для читаемости подсказок
void (null as unknown as _Frame);

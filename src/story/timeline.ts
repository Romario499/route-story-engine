// Сценарий ролика: три акта по таблице, темп, одна событийная подпись, камера и цифры кадра. Всё тяжёлое
// считается в buildTimeline, frameAt(t) — чистая функция от t по готовым таблицам (без состояния между кадрами:
// перемотка к t даёт тот же кадр, что и последовательный просмотр).
import {
  FPS, MAP_VIEWPORT,
  type ActiveCard, type Beat, type BeatKind, type Country, type Enrichment, type FrameState, type FrameStats, type Place,
  type Route, type StorySettings, type TransportChange,
} from '../types';
import { chapterMoodAt, matchChapters, paceWithChapterReading, type ReadingBudget } from './chapters';
import { beatTitle, transportTitle } from '../i18n';
import { averagedSamples, cameraCubic, easeInOut, journeyCamera, journeyViewM, journeyZoom, overviewCamera, planWaypointCenter, planWaypointZoom, toCamera, transition, waypointChapterZoom, WAYPOINT_ZOOM_SPEED, type Mcam } from './camera';
import { factsAt, HOP_VIEW_RATIO, journeyFacts, overviewLabels, waypointPacingRoute, WAYPOINT_TRANSFER_COST } from './legs';
import { latOf, lonOf, mercX, mercY, type Padding } from './mercator';
import { costShares, planPace, type Dwell, type PacePlan } from './pace';
import { directedJourney, regionOverview, shotAt } from './director';

export interface Timeline {
  durationSec: number; frameCount: number; frameAt(t: number): FrameState;
  /** Numeric acceptance diagnostics; never used to change the narrative. Times are film seconds. */
  waypointCameraPlan?: { diveFrom: number; diveTo: number; pullFrom: number; pullTo: number;
    windows: { start: number; plateauStart: number; plateauEnd: number; end: number; amplitude: number }[] };
  waypointTiming?: { feasible: boolean; requiredSec: number; availableSec: number };
}
export interface TimelineOptions {
  /** V5 режиссура; legacy прямой вызов без опций — false, timelineOptionsFor — true. */
  cinematic?: boolean;
  /** Потолок зума сопровождения; без опции 16.5. DEM-профили задают 13.9 (MapLibre 4.7.1). */
  maxJourneyZoom?: number;
  /** Адаптер нормализованного pitch к физическим градусам; задаётся профилем стиля. */
  maxPitch?: number;
  /** Отступы общего плана (интро и финал) в CSS-пикселях MAP_VIEWPORT — место под заголовок и итоговую карточку. По умолчанию 10% меньшей стороны со всех сторон. */
  overviewPadding?: Padding;
  /**
   * Отступы путешествия в CSS-пикселях MAP_VIEWPORT — зоны HUD (показатели, плашки), куда голова заходить не должна.
   * Камера ставит голову в центр оставшейся свободной области. Без параметра — голова у центра кадра.
   */
  journeyPadding?: Padding;
}

/** Раскадровка ТЗ §7: интро 0…intro, путешествие intro…journeyEnd, финал journeyEnd…длительность (секунды). */
export const ACTS: Record<15 | 30 | 45 | 60, { intro: number; journeyEnd: number }> = {
  15: { intro: 2.5, journeyEnd: 12 },
  30: { intro: 3, journeyEnd: 26 },
  45: { intro: 4, journeyEnd: 40 },
  60: { intro: 5, journeyEnd: 54 },
};
/** Время чтения подписи: обычной — не меньше READ_MIN_SEC, длинной — READ_LONG_SEC (полная яркость, без появления и гашения). */
export const READ_MIN_SEC = 1.5;
export const READ_LONG_SEC = 2;
/** Сколько секунд в конце ролика камера неподвижна и итог читается: 2 с при 15, 3 с при ≥ 30. */
export const OUTRO_HOLD_SEC = (durationSec: number): number => (durationSec < 30 ? 2 : 3);

const actsFor = (D: number): { intro: number; journeyEnd: number } =>
  (ACTS as Record<number, { intro: number; journeyEnd: number }>)[D] ?? { intro: D * 0.1, journeyEnd: D * (26 / 30) };

/** Интро: название проявляется за TITLE_APPEAR_SEC с уровня TITLE_FLOOR (первый кадр не пустой), гаснет за TITLE_FADE_SEC до конца интро. */
const TITLE_APPEAR_SEC = 0.35;
const TITLE_FLOOR = 0.4;
const TITLE_FADE_SEC = 0.6;
/**
 * Спуск к старту (история 130: при 30 с — 3…7 с): камера начинает снижаться, когда название уже гаснет
 * (за TITLE_FADE_SEC до конца интро), и садится на старт через START_HOLD_SHARE путешествия после его начала.
 * Всё это время «голова» стоит на старте — видно масштаб, а старт остаётся в кадре.
 */
const START_HOLD_SHARE = 0.17;
const WAYPOINT_START_HOLD_SHARE = 0.06;
/** Отъезд к полному маршруту кончается к началу финала (история 79): длина — доля путешествия в пределах. */
const PULL_SHARE = 0.17;
const PULL_MIN_SEC = 2.0;
const PULL_MAX_SEC = 3;
/** Карточка «Старт» появляется не сразу после гашения названия, а через столько секунд после начала путешествия. */
const START_CARD_DELAY_SEC = 0.55;
/** Голова приходит на финиш не раньше, чем за время карточки «Финиш» (и длину отъезда) до начала финала, но не позже этой доли путешествия. */
const FINISH_WAIT_MAX_SHARE = 0.35;
/** Плашки страны и «рядом» меняются не чаще раза в это число секунд: короткие перескоки у границы схлопываются. */
const MIN_STEP_SEC = 1;
/** Итоговая карточка проявляется не дольше этого и успевает к концу отъезда. */
const OUTRO_CARD_FADE_SEC = 1;
/** Карточка бита: появление, чтение на полной яркости (READ_*), гашение; между карточками — пауза. */
const CARD_FADE_IN_SEC = 0.3;
const CARD_FADE_OUT_SEC = 0.3;
const CARD_ENTER_SEC = 0.4;
const CARD_GAP_SEC = 0.15;
/** Подпись длиннее этого числа знаков читается READ_LONG_SEC. */
const LONG_CAPTION_CHARS = 20;
/** Добавочное время на бит: доля путешествия, в пределах [0,6; 1,2] с; множитель по виду бита. */
const DWELL_SHARE = 0.04;
const KIND_WEIGHT: Record<BeatKind, number> = { start: 1, finish: 1, country: 1, peak: 0.9, waypoint: 0.6 };
const KIND_PRIORITY: Record<BeatKind, number> = { start: 5, finish: 5, country: 4, peak: 3, waypoint: 2 };
/** Смена транспорта на маршруте по меткам: важнее высшей точки, но ниже въезда в страну. */
const TRANSPORT_PRIORITY = 3.5;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (x: number) => { const s = clamp01(x); return s * s * (3 - 2 * s); };
const easeOutCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3;

interface ScheduledCard { beat: Beat; transport?: TransportChange; start: number; plateauEnd: number; end: number }
/**
 * time — когда событие наступает; earliest — раньше этого карточка появиться не может; lead — на сколько раньше time начинается появление.
 * transport — смена транспорта (маршрут по меткам); weight — весомость среди равных по приоритету (число участков серии).
 */
interface Candidate { beat: Beat; time: number; earliest: number; lead: number; transport?: TransportChange; weight?: number }

/**
 * Одна подпись за раз: кандидаты берутся по приоритету (старт/финиш > страна > пик > остановки), карточка
 * принимается, если не пересекается с уже принятыми (с паузой). Время чтения не сжимается — лишние события отбрасываются.
 * Карточки живут только внутри путешествия [from, to] и не раньше своего события (earliest).
 */
function scheduleCards(items: Candidate[], lang: StorySettings['lang'], from: number, to: number): ScheduledCard[] {
  const prio = (c: Candidate) => (c.transport ? TRANSPORT_PRIORITY : KIND_PRIORITY[c.beat.kind]);
  const order = [...items].sort((a, b) => prio(b) - prio(a) || (b.weight ?? 0) - (a.weight ?? 0) || a.time - b.time);
  const accepted: ScheduledCard[] = [];
  for (const it of order) {
    const total = cardTotal(it.beat, lang, it.transport);
    const lo = Math.max(from, it.earliest), hi = to - total;
    if (hi < lo) continue;
    const start = Math.max(lo, Math.min(it.time - it.lead, hi));
    const end = start + total;
    if (accepted.some((c) => c.start < end + CARD_GAP_SEC && c.end + CARD_GAP_SEC > start)) continue;
    accepted.push({ beat: it.beat, transport: it.transport, start, plateauEnd: end - CARD_FADE_OUT_SEC, end });
  }
  return accepted.sort((a, b) => a.start - b.start);
}

/** Полное время карточки: появление, чтение (длинной подписи — дольше), гашение. */
function cardTotal(beat: Beat, lang: StorySettings['lang'], transport?: TransportChange): number {
  const title = transport ? transportTitle(lang, transport) : beatTitle(lang, beat);
  const read = title.length > LONG_CAPTION_CHARS ? READ_LONG_SEC : READ_MIN_SEC;
  return CARD_FADE_IN_SEC + read + CARD_FADE_OUT_SEC;
}

/**
 * Шаги «значение со времени at»: сегменты короче MIN_STEP_SEC (кроме последнего) вливаются в предыдущий, соседние равные
 * сливаются. Так перескоки A→B→A у границы дают одно значение, а смены идут не чаще MIN_STEP_SEC.
 */
function debounceSteps<T>(raw: { at: number; value: T }[], same: (a: T, b: T) => boolean): { at: number; value: T }[] {
  const steps = raw.map((r) => ({ ...r }));
  for (;;) {
    let k = 0;
    while (k < steps.length - 1 && steps[k + 1].at - steps[k].at >= MIN_STEP_SEC) k++;
    if (k >= steps.length - 1) return steps;
    // короткий сегмент k вливается в предыдущий; у первого — следующий шаг берёт его начало (путешествие начинается в at первого)
    if (k === 0) steps[1].at = steps[0].at;
    steps.splice(k, 1);
    for (let i = steps.length - 1; i > 0; i--) if (same(steps[i - 1].value, steps[i].value)) steps.splice(i, 1);
  }
}

/**
 * Шаги «значение со времени at» с ограничением частоты: смена не чаще MIN_STEP_SEC. Короткие смены не вливаются
 * в первое значение цепочки (так «Трабзон» держался бы всю дорогу), а склеиваются в одну отложенную — в момент
 * `последняя смена + MIN_STEP_SEC` показывается то, что на самом деле рядом в этот момент (в том числе «ничего»).
 */
function rateLimitSteps<T>(raw: { at: number; value: T }[], same: (a: T, b: T) => boolean): { at: number; value: T }[] {
  if (!raw.length) return [];
  const out = [{ ...raw[0] }];
  let pending: { value: T } | null = null;
  for (const r of raw.slice(1)) {
    let last = out[out.length - 1];
    if (pending && last.at + MIN_STEP_SEC <= r.at) {
      out.push({ at: last.at + MIN_STEP_SEC, value: pending.value });
      pending = null;
      last = out[out.length - 1];
    }
    if (r.at - last.at >= MIN_STEP_SEC) { out.push({ ...r }); pending = null; } else pending = { value: r.value };
  }
  if (pending) out.push({ at: out[out.length - 1].at + MIN_STEP_SEC, value: pending.value });
  return out.filter((st, i) => i === 0 || !same(out[i - 1].value, st.value));
}

const sameCountry = (a: Country | null, b: Country | null) => (a === null || b === null ? a === b : a.iso2 === b.iso2);
const samePlace = (a: Place | null, b: Place | null) =>
  a === b || (a !== null && b !== null && a.nameEn === b.nameEn && a.lat === b.lat && a.lon === b.lon);

/** Индекс последнего элемента с at ≤ t (элементы по возрастанию at); -1, если таких нет. */
function lastAtOrBefore(list: { at: number }[], t: number): number {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Подтверждённая смена страны получает время на плашку даже без событийной карточки.
 * Это выдержка у метки, а не вывод о длительности посещения из markedAt. */
function withCountryHolds(base: PacePlan, indices: number[]): PacePlan {
  if (!indices.length) return base;
  const hold = Math.min(0.9, base.moveSec * 0.25 / indices.length);
  const scale = (base.moveSec - hold * indices.length) / base.moveSec;
  const stops = indices.map((idx, i) => ({ idx, at: base.timeOfIdx(idx) * scale + i * hold }));
  return { moveSec: base.moveSec, cruiseMps: base.cruiseMps / scale,
    timeOfIdx: idx => base.timeOfIdx(idx) * scale + stops.filter(s => s.idx < idx).length * hold,
    headAt(tau) {
      let elapsed = 0;
      for (const stop of stops) {
        if (tau < stop.at) break;
        if (tau <= stop.at + hold) return stop.idx;
        elapsed += hold;
      }
      return base.headAt((tau - elapsed) / scale);
    },
  };
}

export function buildTimeline(
  route: Route, enrichment: Enrichment, settings: StorySettings, opts: TimelineOptions = {},
): Timeline {
  const D = settings.durationSec;
  const frameCount = Math.round(D * FPS);
  const { intro: introEnd, journeyEnd } = actsFor(D);
  const journeySec = journeyEnd - introEnd;
  const outroHold = OUTRO_HOLD_SEC(D);
  const pullLen = Math.max(PULL_MIN_SEC, Math.min(PULL_MAX_SEC, PULL_SHARE * journeySec));
  const countryReading = route.source?.kind === 'waypoints' && route.waypointOrderConfirmed === true && D === 60;
  const startHold = countryReading ? 0.3 : (route.source?.kind === 'waypoints' ? WAYPOINT_START_HOLD_SHARE : START_HOLD_SHARE) * journeySec;
  /** Когда «голова» трогается со старта. */
  const moveStart = introEnd + startHold;

  const pts = route.points;
  const last = pts.length - 1;
  const viewport = MAP_VIEWPORT[settings.format];
  // Маршрут по меткам (ADR 0010): у него нет длины трека (`d` = 0), поэтому темп и камера считаются по «длине по прямой»
  // между метками (поезд и очень длинные скачки — как переезды), а показатели берутся из фактов о метках.
  const facts = journeyFacts(route);
  if (facts && !route.waypointOrderConfirmed) {
    const overview = overviewCamera(route, viewport, opts.overviewPadding);
    // Обзор камеры с запада на восток по bbox; порядок меток не меняется и не изображает движение человека.
    return { durationSec: D, frameCount, frameAt(tIn): FrameState {
      const t = Math.max(0, Math.min(D, Number.isFinite(tIn) ? tIn : 0));
      const act = t < introEnd ? 'intro' : t < journeyEnd ? 'journey' : 'outro';
      const u = smoothstep((t - introEnd) / journeySec);
      const x = mercX(route.bbox[0]) + (mercX(route.bbox[2]) - mercX(route.bbox[0])) * u;
      const focus = { ...overview, x, zoom: overview.zoom + 0.6 };
      const rawCamera = opts.cinematic ? regionOverview(route, overview, t, introEnd, journeyEnd) :
        act === 'journey' ? transition(overview, focus, Math.sin(Math.PI * u) ** 2) : overview;
      const camera = { ...rawCamera, zoom: Math.min(8, rawCamera.zoom) };
      // Служебная голова — метка у центра обзора; плашку и город отдельно определяет область кадра.
      let head = 0, best = Infinity;
      pts.forEach((p, i) => { const d = (mercX(p.lon) - camera.x) ** 2 + (mercY(p.lat) - camera.y) ** 2;
        if (d < best) { best = d; head = i; } });
      const labels = overviewLabels(route, enrichment, toCamera(camera), viewport);
      return { t, act, head, headLonLat: [pts[head].lon, pts[head].lat], camera: toCamera(camera),
        ...(opts.cinematic ? { shot: shotAt(t, D) } : {}),
        stats: { distanceKm: 0, progress: 0, country: labels.country, place: labels.place }, cards: [],
        introAlpha: act === 'intro' ? Math.min(1, TITLE_FLOOR + t / TITLE_APPEAR_SEC) * (1 - smoothstep((t - introEnd + TITLE_FADE_SEC) / TITLE_FADE_SEC)) : 0,
        outroAlpha: act === 'outro' ? smoothstep((t - journeyEnd) / OUTRO_CARD_FADE_SEC) : 0, showFinish: false };
    } };
  }

  // --- темп и карточки: сначала со всеми битами, затем только с теми, чьи карточки поместились (до 3 раз)
  // Названия меток и «высшая точка» в маршруте по меткам не показываются: названия — личные, высот у меток нет.
  const beats = enrichment.beats
    .filter((b) => b.idx >= 0 && b.idx <= last && !(facts && (b.kind === 'waypoint' || b.kind === 'peak')))
    .map(b => facts && (b.kind === 'start' || b.kind === 'finish') ? { ...b, country: enrichment.countryAt(b.idx) ?? undefined } : b)
    .sort((a, b) => a.idx - b.idx);
  // голова приходит на финиш не раньше, чем карточке «Финиш» хватит времени до начала финала
  const finishBeat = beats.find((b) => b.kind === 'finish');
  const finishWait = Math.max(pullLen, finishBeat ? Math.min(cardTotal(finishBeat, settings.lang), FINISH_WAIT_MAX_SHARE * journeySec) : 0);
  const moveSec = Math.max(1, journeySec - startHold - finishWait);
  const baseDwell = Math.max(0.6, Math.min(1.2, DWELL_SHARE * journeySec));
  const dwellsOf = (list: Beat[]): Dwell[] => list.map((b) => ({ idx: b.idx, sec: baseDwell * KIND_WEIGHT[b.kind] }));
  // Скачки между метками длиннее ~2,6 окон путешествия идут быстрее (камера на них поднимается): окно зависит от скорости головы,
  // поэтому сначала ход без переездов, по нему окно, затем окончательный темп.
  let pacing = route;
  if (facts) {
    const flat = waypointPacingRoute(route, facts);
    const viewM = journeyViewM(flat, planPace(flat, moveSec, []).cruiseMps);
    pacing = waypointPacingRoute(route, facts, (HOP_VIEW_RATIO * viewM) / 1000);
  }

  interface CountryStep { at: number; from: Country | null; to: Country | null }
  /** Плашка страны: смены от момента, когда голова доходит до первой точки новой страны, без перескоков чаще MIN_STEP_SEC. */
  const countryStepsOf = (plan: PacePlan): CountryStep[] => {
    const raw: { at: number; value: Country | null }[] = [];
    let prev: Country | null = null;
    for (let i = 0; i <= last; i++) {
      const c = enrichment.countryAt(i);
      if (i > 0 && sameCountry(prev, c)) continue;
      raw.push({ at: i === 0 ? introEnd : Math.max(raw[raw.length - 1].at, moveStart + plan.timeOfIdx(i)), value: c });
      prev = c;
    }
    // Метки — события, а не GPS-границы: короткую страну нельзя переносить на старт или на соседний перелёт.
    return (facts ? raw : debounceSteps(raw, sameCountry)).map((st, k, all) => ({ at: st.at, from: k === 0 ? null : all[k - 1].value, to: st.value }));
  };
  const candidatesOf = (plan: PacePlan, list: Beat[], steps: CountryStep[]): Candidate[] => {
    const out: Candidate[] = [];
    for (const beat of list) {
      const time = moveStart + plan.timeOfIdx(beat.idx);
      if (beat.kind === 'start') {
        // старт показываем во время спуска камеры, а не после того, как голова тронулась
        const at = introEnd + START_CARD_DELAY_SEC;
        out.push({ beat, time: at + CARD_FADE_IN_SEC, earliest: at, lead: CARD_FADE_IN_SEC });
      } else if (beat.kind === 'finish') out.push({ beat, time, earliest: time, lead: 0 }); // не раньше прихода головы
      else if (beat.kind === 'country') {
        // карточка страны — только к настоящей смене плашки и не раньше неё больше чем на CARD_FADE_IN_SEC
        const step = steps.find((st) => st.to !== null && beat.country !== undefined && sameCountry(st.to, beat.country) && Math.abs(st.at - time) <= 0.35);
        if (step) out.push({ beat, time: step.at, earliest: step.at - CARD_FADE_IN_SEC, lead: CARD_FADE_IN_SEC });
      } else out.push({ beat, time, earliest: introEnd, lead: CARD_FADE_IN_SEC });
    }
    // смена транспорта: подпись, когда голова входит в новую серию участков (первая серия — это старт, подписи смены у неё нет)
    if (facts) {
      for (const run of facts.runs.slice(1)) {
        out.push({
          beat: { kind: 'waypoint', idx: run.fromIdx }, time: moveStart + plan.timeOfIdx(run.fromIdx), earliest: introEnd,
          lead: CARD_FADE_IN_SEC, transport: { kind: run.kind, confidence: run.confidence, fromIdx: run.fromIdx, toIdx: run.toIdx }, weight: run.legCount,
        });
      }
    }
    return out;
  };

  const countryStops = facts ? pts.flatMap((_, i) => i > 0 && i < last
    && !sameCountry(enrichment.countryAt(i - 1), enrichment.countryAt(i)) ? [i] : []) : [];
  const matched = matchChapters(route, enrichment);
  const readingSec = (c: NonNullable<Route['chapters']>[number]) => Math.max(READ_MIN_SEC,
    (c.title[settings.lang].length + c.text[settings.lang].length) / 28) + CARD_FADE_IN_SEC + CARD_FADE_OUT_SEC + CARD_GAP_SEC;
  const runs: { fromIdx: number; toIdx: number }[] = [];
  if (countryReading) for (let i = 0; i <= last; i++) {
    const c = enrichment.countryAt(i);
    if (!c) continue;
    const prev = runs.at(-1);
    if (prev && prev.toIdx === i - 1 && sameCountry(enrichment.countryAt(prev.fromIdx), c)) prev.toIdx = i;
    else runs.push({ fromIdx: i, toIdx: i });
  }
  // Country labels remain visible during chapters. Only ordinary cards are excluded
  // from the reserved tails; two extra frames protect inclusive frame sampling.
  const readingBudget: ReadingBudget | undefined = countryReading ? { runs, last, labelSec: 3 + 2 / FPS,
    firstDelaySec: START_CARD_DELAY_SEC, positionWeights: costShares(pacing, WAYPOINT_TRANSFER_COST).u } : undefined;
  const makePace = (list: Beat[]) => {
    const base = planPace(pacing, moveSec, dwellsOf(list), facts ? WAYPOINT_TRANSFER_COST : undefined);
    if (!readingBudget) return withCountryHolds(base, countryStops);
    const reserved = paceWithChapterReading(base, matched, moveSec, readingSec, readingBudget);
    // An infeasible country budget must not also discard the accepted chapter reading.
    // Keep the failure in waypointTiming; this fallback does not claim country coverage.
    return readingBudget.result?.feasible ? reserved
      : paceWithChapterReading(base, matched, moveSec, readingSec);
  };
  let shown = beats;
  let pace = makePace(shown);
  let countrySteps = countryStepsOf(pace);
  let cards = scheduleCards(candidatesOf(pace, shown, countrySteps), settings.lang, introEnd, journeyEnd);
  for (let pass = 0; pass < 3 && cards.filter((c) => !c.transport).length < shown.length; pass++) {
    shown = cards.filter((c) => !c.transport).map((c) => c.beat).sort((a, b) => a.idx - b.idx);
    pace = makePace(shown);
    countrySteps = countryStepsOf(pace);
    cards = scheduleCards(candidatesOf(pace, shown, countrySteps), settings.lang, introEnd, journeyEnd);
  }

  // Главы не добавляют стоянок: при нехватке чтения перераспределяется непрерывное движение.
  const scheduleChapters = (): { chapter: NonNullable<Route['chapters']>[number]; start: number; end: number; idx: number }[] => {
    const chapterCards: { chapter: NonNullable<Route['chapters']>[number]; start: number; end: number; idx: number }[] = [];
    const seen = new Set<string>();
    let chapterEnd = introEnd;
    for (const m of matched.filter((m) => !m.chapter.finale)) {
      if (seen.has(m.chapter.id)) continue;
      const start = Math.max(chapterEnd, m.fromIdx === 0 ? introEnd + START_CARD_DELAY_SEC : moveStart + pace.timeOfIdx(m.fromIdx));
      const read = Math.max(READ_MIN_SEC, (m.chapter.title[settings.lang].length + m.chapter.text[settings.lang].length) / 28);
      const end = start + CARD_FADE_IN_SEC + read + CARD_FADE_OUT_SEC;
      // Нельзя переносить воспоминание в другую страну/регион ради заполнения слота.
      const leave = m.toIdx < last ? moveStart + (m.fromIdx === m.toIdx && pace.departureOfIdx
        ? pace.departureOfIdx(m.toIdx) : pace.timeOfIdx(m.toIdx)) : journeyEnd;
      if (end > Math.min(journeyEnd, leave)) continue;
      chapterCards.push({ chapter: m.chapter, start, end, idx: m.fromIdx });
      seen.add(m.chapter.id);
      chapterEnd = end + CARD_GAP_SEC;
    }
    return chapterCards;
  };
  let chapterCards = scheduleChapters();
  const wanted = new Set(matched.filter(m => !m.chapter.finale).map(m => m.chapter.id)).size;
  if (chapterCards.length < wanted && !readingBudget) {
    pace = paceWithChapterReading(pace, matched, moveSec, c => Math.max(READ_MIN_SEC, (c.title[settings.lang].length + c.text[settings.lang].length) / 28) + CARD_FADE_IN_SEC + CARD_FADE_OUT_SEC + CARD_GAP_SEC);
    countrySteps = countryStepsOf(pace);
    cards = scheduleCards(candidatesOf(pace, shown, countrySteps), settings.lang, introEnd, journeyEnd);
    chapterCards = scheduleChapters();
  }
  if (readingBudget?.result?.feasible) {
    const tails = runs.map(r => {
      const end = moveStart + (r.fromIdx === r.toIdx ? pace.departureOfIdx!(r.toIdx) : pace.timeOfIdx(r.toIdx));
      return { from: end - readingBudget.labelSec, to: end };
    });
    cards = cards.filter(c => c.beat.kind === 'country' || !tails.some(r => c.start < r.to && c.end > r.from));
  }

  const lonLatAt = (head: number): [number, number] => {
    const i = Math.min(last, Math.floor(head));
    const j = Math.min(last, i + 1);
    const f = head - i;
    // метки лежат на разных широтах: отрезок прямой на карте (Меркатор), а не в градусах — голова остаётся на нарисованной линии
    if (facts && f === 0) return [pts[i].lon, pts[i].lat];
    if (facts) return [lonOf(mercX(pts[i].lon) + (mercX(pts[j].lon) - mercX(pts[i].lon)) * f), latOf(mercY(pts[i].lat) + (mercY(pts[j].lat) - mercY(pts[i].lat)) * f)];
    return [pts[i].lon + (pts[j].lon - pts[i].lon) * f, pts[i].lat + (pts[j].lat - pts[i].lat) * f];
  };

  // --- камера
  const overview = overviewCamera(route, viewport, opts.overviewPadding);
  const maxZoom = facts ? Math.min(opts.maxJourneyZoom ?? 16.5, 8) : opts.maxJourneyZoom ?? 16.5;
  const chapterZoom = facts && chapterCards.length ? Math.min(maxZoom, Math.max(overview.zoom, waypointChapterZoom(route, viewport))) : undefined;
  // Между главами — общий план; чтение не отодвигает региональный план камеры.
  const baseZoom = Math.min(maxZoom, journeyZoom(pacing, viewport, pace.cruiseMps, overview.zoom),
    chapterZoom === undefined ? Infinity : Math.max(overview.zoom, chapterZoom - 2));
  const jp = opts.journeyPadding;
  const baseJourney = journeyCamera({
    route: pacing, viewport, journeySec, baseZoom,
    headIdxAt: (tau) => pace.headAt(tau - startHold),
    beatTimes: cards.map((c) => c.start + CARD_FADE_IN_SEC - introEnd),
    ...(chapterZoom === undefined ? {} : { chapterZoom,
      chapterWindows: chapterCards.map(c => ({ start: c.start - introEnd, end: c.end - introEnd })),
      chapterCameraBounds: { from: 0.8 - introEnd, to: journeySec - 0.5 } }),
    // Waypoint HUD displacement is applied only after the final whole-film zoom.
    shiftPx: jp && !facts ? { x: (jp.left - jp.right) / 2, y: (jp.top - jp.bottom) / 2 } : undefined,
  });
  const jcam = opts.cinematic && !facts ? directedJourney(pacing, D, introEnd, journeySec,
    tau => pace.headAt(tau - startHold), baseJourney, opts.maxJourneyZoom, opts.maxPitch) : baseJourney;

  // спуск: от общего плана к камере путешествия, садится к концу выдержки на старте; отъезд: от камеры путешествия
  // к общему плану, кончается к началу финала — маршрут раскрыт целиком до итоговой карточки. Оба — ease-in-out.
  const diveFrom = opts.cinematic ? 0.8 : Math.max(0, introEnd - TITLE_FADE_SEC);
  const diveTo = moveStart;
  const pullTo = facts ? journeyEnd - 0.25 : journeyEnd;
  const peakJourneyZoom = facts ? Math.max(...Array.from({ length: Math.ceil(journeySec * 60) + 1 }, (_, i) => jcam.at(Math.min(journeySec, i / 60)).zoom)) : 0;
  const pullFrom = facts ? Math.max(diveTo, pullTo - 1.5 * Math.max(0, peakJourneyZoom - overview.zoom) / WAYPOINT_ZOOM_SPEED) : journeyEnd - pullLen;
  const rawCameraAt = (t: number): Mcam => {
    if (opts.cinematic && !facts) {
      const prologueEnd = 2.1 * D / 15, finaleStart = 12.4 * D / 15;
      const p = opts.maxPitch ?? 74;
      if (t >= D) return overview;
      if (t < prologueEnd) {
        const e = easeInOut(t / prologueEnd);
        const target = jcam.at(Math.max(0, t - introEnd));
        const c = transition(overview, target, e);
        return { ...c, pitch: 15 / p + (target.pitch - 15 / p) * e };
      }
      if (t < finaleStart) return jcam.at(Math.max(0, t - introEnd));
      const e = easeInOut((t - finaleStart) / (D - finaleStart - 0.6));
      const c = transition(jcam.at(finaleStart - introEnd), overview, e);
      // Последняя выдержка — спокойный общий план, с сохранённой DEM-геометрией.
      return { ...c, pitch: (40 - 20 * e) / p * (1 - easeInOut((t - D + 0.6) / 0.6)) };
    }
    if (t < diveTo) {
      const e = (facts ? cameraCubic : easeInOut)((t - diveFrom) / (diveTo - diveFrom));
      return transition(overview, jcam.at(Math.max(0, t - introEnd)), e);
    }
    if (t < pullFrom) return jcam.at(t - introEnd);
    if (t >= pullTo) return overview;
    const e = (facts ? cameraCubic : easeInOut)((t - pullFrom) / (pullTo - pullFrom));
    return transition(jcam.at(Math.min(journeySec, t - introEnd)), overview, e);
  };
  // Сглаживаем стыки сцен на общей сетке, включая пролог/финал. Случайный seek
  // использует ту же таблицу; ограничение ускорения не зависит от истории просмотра.
  const cameraHz = 60, cameraCount = Math.round(D * cameraHz) + 1;
  const rawCameras = opts.cinematic && !facts ? Array.from({ length: cameraCount }, (_, i) => rawCameraAt(i / cameraHz)) : null;
  const cameras = rawCameras?.map((c, i) => {
    let x = 0, y = 0, zoom = 0, pitch = 0, bearing = 0, sum = 0;
    for (let k = i - 48; k <= i + 48; k++) {
      const w = Math.exp(-0.5 * ((k - i) / 16) ** 2), v = rawCameras[Math.max(0, Math.min(cameraCount - 1, k))];
      x += v.x * w; y += v.y * w; zoom += v.zoom * w; pitch += v.pitch * w;
      bearing += ((c.bearing ?? 0) + (((v.bearing ?? 0) - (c.bearing ?? 0) + 540) % 360) - 180) * w;
      sum += w;
    }
    return { x: x / sum, y: y / sum, zoom: zoom / sum, pitch: pitch / sum, bearing: bearing / sum };
  });
  const legacyCameraAt = (t: number): Mcam => {
    if (!cameras) return rawCameraAt(t);
    if (t >= D) return overview;
    const q = Math.max(0, t * cameraHz), i = Math.min(cameraCount - 2, Math.floor(q)), f = q - i;
    const a = cameras[i], b = cameras[i + 1];
    const endFade = 1 - easeInOut((t - D + 0.8) / 0.8);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f,
      zoom: a.zoom + (b.zoom - a.zoom) * f, pitch: (a.pitch + (b.pitch - a.pitch) * f) * endFade,
      bearing: ((a.bearing ?? 0) + ((b.bearing ?? 0) - (a.bearing ?? 0)) * f) * endFade };
  };
  // Pure precomputation after the complete raw camera, including act transitions.
  const waypointZoom = facts ? planWaypointZoom(t => rawCameraAt(t).zoom, D, journeyEnd, overview.zoom, maxZoom) : null;
  const waypointRaw = facts ? Array.from({ length: cameraCount }, (_, i) => rawCameraAt(i / cameraHz)) : null;
  const waypointX = waypointRaw ? averagedSamples(Float64Array.from(waypointRaw, c => c.x), 1 / cameraHz) : null;
  const waypointY = waypointRaw ? averagedSamples(Float64Array.from(waypointRaw, c => c.y), 1 / cameraHz) : null;
  const waypointPitch = waypointRaw ? averagedSamples(Float64Array.from(waypointRaw, c => c.pitch), 1 / cameraHz) : null;
  const hudWeight = (t: number) => cameraCubic((t - diveFrom) / (diveTo - diveFrom))
    * (1 - cameraCubic((t - pullFrom) / Math.max(1e-9, pullTo - pullFrom)));
  const desiredCameraAt = (t: number): Mcam => {
    if (!waypointZoom || !waypointX || !waypointY || !waypointPitch) return legacyCameraAt(t);
    const zoom = waypointZoom(t), world = 512 * 2 ** zoom, weight = hudWeight(t);
    return { x: waypointX(t) - (jp ? (jp.left - jp.right) / 2 : 0) * weight / world,
      y: waypointY(t) - (jp ? (jp.top - jp.bottom) / 2 : 0) * weight / world,
      zoom, pitch: waypointPitch(t) };
  };
  const cameraAt = countryReading && opts.cinematic ? planWaypointCenter(desiredCameraAt, t => {
    const p = lonLatAt(pace.headAt(t - moveStart));
    return [mercX(p[0]), mercY(p[1])];
  }, D, introEnd, journeyEnd, viewport, jp, opts.maxPitch ?? 74, overview,
  t => chapterCards.some(c => t >= c.start - 1 && t <= c.end + 0.5), chapterCards) : desiredCameraAt;

  // --- «рядом»: ближайшее место по точкам маршрута; смена — когда голова доходит до первой точки с другим местом
  interface PlaceStep { at: number; place: Place | null }
  const rawPlaces: { at: number; value: Place | null }[] = [];
  for (let i = 0; i <= last; i++) {
    const place = enrichment.placeAt(i);
    if (i > 0 && samePlace(rawPlaces[rawPlaces.length - 1].value, place)) continue;
    rawPlaces.push({ at: i === 0 ? introEnd : Math.max(rawPlaces[rawPlaces.length - 1].at, moveStart + pace.timeOfIdx(i)), value: place });
  }
  const placeSteps: PlaceStep[] = rateLimitSteps(rawPlaces, samePlace).map((st) => ({ at: st.at, place: st.value }));

  // --- цифры
  const introStats: FrameStats = { distanceKm: 0, progress: 0, country: null, place: null };
  const statsAt = (head: number, moving: boolean, country: Country | null, place: Place | null): FrameStats => {
    if (facts) {
      // по меткам: «км» — накопленное расстояние по прямой (нижняя оценка, подписывает оформление), прогресс — доля меток;
      // дат, дней, скорости и высоты у меток нет
      return { distanceKm: factsAt(facts, head).straightKm, progress: last > 0 ? Math.min(1, head / last) : 1, country, place };
    }
    const i = Math.min(last, Math.floor(head));
    const j = Math.min(last, i + 1);
    const f = head - i;
    const d = head >= last ? route.totalM : pts[i].d + (pts[j].d - pts[i].d) * f;
    const stats: FrameStats = {
      distanceKm: d / 1000,
      progress: route.totalM > 0 ? Math.min(1, d / route.totalM) : 1,
      country,
      place,
    };
    if (route.hasTime) {
      if (route.day) stats.day = route.day[i];
      const ti = pts[i].time, tj = pts[j].time;
      if (ti !== undefined && tj !== undefined) {
        // солнечный пояс по долготе — как у дней в route.day; форматировать в UTC
        stats.date = ti + (tj - ti) * f + Math.round(pts[i].lon / 15) * 3_600_000;
      }
      const v = route.speedKmh?.[i];
      if (moving && v !== undefined && Number.isFinite(v)) stats.speedKmh = v;
    }
    if (route.hasEle) {
      const ei = pts[i].ele, ej = pts[j].ele;
      if (ei !== undefined) stats.altitudeM = ej !== undefined ? ei + (ej - ei) * f : ei;
    }
    return stats;
  };

  const cardsAt = (t: number): ActiveCard[] => {
    for (const c of cards) {
      if (t <= c.start || t >= c.end) continue;
      const alpha = Math.min(smoothstep((t - c.start) / CARD_FADE_IN_SEC), smoothstep((c.end - t) / CARD_FADE_OUT_SEC));
      if (alpha <= 0) continue;
      const card: ActiveCard = { beat: c.beat, alpha, enter: easeOutCubic((t - c.start) / CARD_ENTER_SEC) };
      if (c.transport) card.transport = c.transport;
      return [card];
    }
    return [];
  };

  // Одна подпись в слоте; вся её анимация определяется временем кадра.
  const chapterCardsAt = (t: number): ActiveCard[] => {
    const c = chapterCards.find((c) => t > c.start && t < c.end);
    if (c) return [{ beat: { kind: 'waypoint', idx: c.idx }, chapter: c.chapter,
      alpha: Math.min(smoothstep((t - c.start) / CARD_FADE_IN_SEC), smoothstep((c.end - t) / CARD_FADE_OUT_SEC)), enter: easeOutCubic((t - c.start) / CARD_ENTER_SEC) }];
    // Обычная подпись не должна мелькать обрезанным фрагментом по краям главы.
    const ordinary = cards.find((c) => t > c.start && t < c.end);
    if (ordinary && chapterCards.some((c) => c.start < ordinary.end + CARD_GAP_SEC && c.end + CARD_GAP_SEC > ordinary.start)) return [];
    return cardsAt(t);
  };
  const finalChapter = matched.find((m) => m.chapter.finale)?.chapter;
  const moodAt = chapterMoodAt(matched, last, (i) => i === 0 ? introEnd : moveStart + pace.timeOfIdx(i), journeyEnd,
    chapterCards.map(c => ({ at: c.start, mood: c.chapter.mood })));

  const titleHoldEnd = introEnd - TITLE_FADE_SEC;
  const introAlphaAt = (t: number): number => {
    if (t >= introEnd) return 0;
    const appear = TITLE_FLOOR + (1 - TITLE_FLOOR) * smoothstep(t / TITLE_APPEAR_SEC);
    return appear * (1 - smoothstep((t - titleHoldEnd) / TITLE_FADE_SEC));
  };
  // итог проявляется в начале финала и успевает к началу выдержки (последние OUTRO_HOLD_SEC)
  const cardTo = D - outroHold;
  const cardFrom = Math.max(journeyEnd, cardTo - OUTRO_CARD_FADE_SEC);

  return {
    durationSec: D,
    frameCount,
    ...(readingBudget?.result ? { waypointTiming: readingBudget.result } : {}),
    ...(facts ? { waypointCameraPlan: { diveFrom, diveTo, pullFrom, pullTo,
      windows: baseJourney.chapterWindows.map(w => ({ ...w, start: w.start + introEnd, plateauStart: w.plateauStart + introEnd,
        plateauEnd: w.plateauEnd + introEnd, end: w.end + introEnd })) } } : {}),
    frameAt(tIn: number): FrameState {
      const t = Math.max(0, Math.min(D, Number.isFinite(tIn) ? tIn : 0));
      const act: FrameState['act'] = t < introEnd ? 'intro' : t < journeyEnd ? 'journey' : 'outro';
      const head = act === 'intro' ? 0 : act === 'outro' ? last : pace.headAt(t - moveStart);
      const outroAlpha = act === 'outro' ? smoothstep((t - cardFrom) / Math.max(1e-6, cardTo - cardFrom)) : 0;
      const base = {
        t, act, head,
        ...(opts.cinematic ? { shot: shotAt(t, D) } : {}),
        ...(matched.length ? { chapterMood: moodAt(t) } : {}),
        headLonLat: lonLatAt(head),
        camera: { ...toCamera(cameraAt(t)), ...(opts.cinematic ? { pitchDegrees: cameraAt(t).pitch * (opts.maxPitch ?? 74) } : {}) },
        introAlpha: introAlphaAt(t),
        outroAlpha,
        showFinish: head >= last,
      };
      if (act === 'intro') return { ...base, stats: introStats, cards: [] };
      const cs = countrySteps[Math.max(0, lastAtOrBefore(countrySteps, t))];
      const ps = placeSteps[Math.max(0, lastAtOrBefore(placeSteps, t))];
      if (facts) {
        const i = Math.min(last, Math.floor(head));
        const from = enrichment.countryAt(i), to = enrichment.countryAt(Math.min(last, i + 1));
        const betweenCountries = head > i && !sameCountry(from, to);
        const country = betweenCountries ? null : from;
        const inHop = pacing.transfers.some((leg) => head > leg.fromIdx && head < leg.toIdx);
        // Только достигнутая метка: не переносим город следующей метки назад во времени.
        const markPlace = betweenCountries || inHop ? null : enrichment.placeAt(i);
        return {
          ...base,
          stats: statsAt(head, act === 'journey', country, markPlace),
          cards: act === 'journey' ? (matched.length ? chapterCardsAt(t) : cardsAt(t)) : [],
          ...(finalChapter && act === 'outro' ? { finalChapter } : {}),
          // У прибытия нет перекрёстного гашения со страной отправления: оно утверждало бы место на перелёте.
          countryChange: { from: null, to: country, at: cs.at },
          placeChange: { at: ps.at, visible: markPlace !== null },
        };
      }
      return {
        ...base,
        stats: statsAt(head, act === 'journey', cs.to, ps.place),
        cards: act === 'journey' ? cardsAt(t) : [],
        countryChange: { from: cs.from, to: cs.to, at: cs.at },
        placeChange: { at: ps.at, visible: ps.place !== null },
      };
    },
  };
}

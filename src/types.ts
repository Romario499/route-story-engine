// Общие формы данных Route Story Engine. Контракт описан в .autopilot/.../interfaces.md.

export interface TrackPoint { lat: number; lon: number; ele?: number; time?: number /* epoch ms */ }
export interface Waypoint { lat: number; lon: number; name: string }
export type WaypointKind = 'overnight' | 'train' | 'stop' | 'unknown';
export type EvidenceConfidence = 'stated' | 'inferred' | 'unknown';
export interface JourneyWaypoint extends Waypoint {
  markedAt?: number; // epoch ms: время создания закладки, НЕ дата визита
  color: string; kind: WaypointKind; confidence: EvidenceConfidence;
  source: { file: string; collection: string }; duplicates: number; // число дополнительных копий
  sources?: { file: string; collection: string }[]; // все коллекции технического дубля
}
/** Серия соседних участков одного вида; общая граничная метка входит в обе серии. */
export interface WaypointLegReport extends TransportChange { waypointCount: number }
export interface WaypointImportReport {
  total: number; unique: number; duplicates: number; included: number; excludedPersonal: number;
  excludedOtherColors?: number;
  kmlFiles: number; lines: number;
  legs: WaypointLegReport[];
  collections: { file: string; collection: string; total: number; unique: number }[];
}
export interface WaypointPeriod { from?: number; to?: number }
export interface WaypointSelection extends WaypointPeriod { collections?: string[]; includeUndated?: boolean; includeOtherColors?: boolean; waypointOrderConfirmed?: boolean }
export interface WaypointArchive { tracks: RawTrack[]; chapters?: Chapter[] }
export interface RawTrack {
  sourceFile: string; name?: string; segments: TrackPoint[][]; waypoints: Waypoint[];
  kmlImport?: { points: JourneyWaypoint[]; lines: number; content: boolean; index: boolean; organic: boolean; collections: string[] };
}
export type ParseResult =
  | { ok: true; tracks: RawTrack[]; warnings: string[]; report?: WaypointImportReport; chapters?: Chapter[] }
  | { ok: false; error: string }            // готовый русский текст для пользователя

export interface RoutePoint extends TrackPoint {
  d: number;               // накопленные метры вдоль маршрута (с переездами)
  seg: number;             // номер сегмента
  transferBefore: boolean; // перед этой точкой — переезд (разрыв)
}
export type ChapterMood = 'cold' | 'heat' | 'rain' | 'altitude' | 'warmth' | 'neutral';
export type CaptionSource = 'gps' | 'organic-maps' | 'traveler';
/** Региональная рамка, не координата ночёвки. Время — создание закладки, не визит. */
export interface Chapter {
  id: string; title: Record<Lang, string>; text: Record<Lang, string>;
  anchor: { countries: string[]; region?: { name: string; bbox: [number, number, number, number] }; markedAt?: { from: number; to: number } };
  mood: ChapterMood; source: 'traveler'; finale?: boolean;
}
export interface ChapterMoodState { weights: Record<ChapterMood, number> }
export interface Route {
  chapters?: Chapter[];
  source?: { kind: 'track' | 'waypoints' };
  journeyWaypoints?: JourneyWaypoint[];
  waypointOrderConfirmed?: boolean; // только явное подтверждение путешественника, не порядок хранения/даты закладок
  importReport?: WaypointImportReport;
  points: RoutePoint[];               // очищенный полный трек
  display: number[];                  // индексы points для отрисовки (≤ ~6000, первая и последняя всегда)
  totalM: number; ownM: number;       // всего / своим ходом (без переездов)
  transfers: { fromIdx: number; toIdx: number }[];
  hasTime: boolean; hasEle: boolean;
  startTime?: number; endTime?: number; days?: number;
  day?: Uint16Array;                  // день путешествия (1-based) по индексу точки; есть, если hasTime
  speedKmh?: Float32Array;            // сглаженная скорость; NaN = стоянка/переезд; есть, если hasTime
  maxEle?: { value: number; idx: number }; minEle?: { value: number; idx: number }; gainM?: number;
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
  waypoints: (Waypoint & { idx: number })[]; // привязаны к ближайшему индексу трека
  name?: string;
}

export interface Country { iso2: string; nameRu: string; nameEn: string }
export interface Place { nameRu: string; nameEn: string; lat: number; lon: number; pop: number }

export type BeatKind = 'start' | 'country' | 'peak' | 'waypoint' | 'finish';
export interface Beat { kind: BeatKind; idx: number; country?: Country; place?: Place | null; label?: string; ele?: number }
export interface Enrichment {
  countryRuns: { fromIdx: number; toIdx: number; country: Country | null }[];
  countries: Country[];               // уникальные, в порядке посещения
  beats: Beat[];                      // по возрастанию idx
  startPlace: Place | null; finishPlace: Place | null;
  placeAt(idx: number): Place | null; // ближайший населённый пункт (≤ 40 км)
  countryAt(idx: number): Country | null;
}

export type Format = '9:16' | '16:9';
export type Lang = 'ru' | 'en';
export type StyleId = 'epic' | 'neon' | 'atlas';
export type InfoKey = 'distance' | 'day' | 'date' | 'country' | 'city' | 'altitude' | 'speed' | 'profile' | 'progress';
export interface StorySettings {
  styleId: StyleId; format: Format; durationSec: 15 | 30 | 45 | 60; lang: Lang;
  info: Record<InfoKey, boolean>; title: string; author: string;
  showSafeZones: boolean;             // только превью, в файл не попадает
}
export interface ViewSize { width: number; height: number }
export const FPS = 30;
/** Размер кадра ролика в дизайн-пикселях. */
export const DESIGN_SIZE: Record<Format, ViewSize> = {
  '9:16': { width: 1080, height: 1920 },
  '16:9': { width: 1920, height: 1080 },
};
/** CSS-размер контейнера карты — ровно половина дизайн-размера (экспорт с pixelRatio 2). */
export const MAP_VIEWPORT: Record<Format, ViewSize> = {
  '9:16': { width: 540, height: 960 },
  '16:9': { width: 960, height: 540 },
};

export interface CameraState {
  center: [number, number]; zoom: number; pitch: number; bearing: number;
  /** Физический наклон DEM-плана; pitch сохраняет прежний нормализованный контракт. */
  pitchDegrees?: number;
}
export type ShotKind = 'prologue' | 'relief' | 'line' | 'point' | 'context' | 'finale';
export interface ShotState {
  kind: ShotKind; number: number; fromSec: number; toSec: number;
  /** Художественный свет и фокус, не погода и не измерения. */
  light: number; focus: number;
}
/** Вид передвижения на участке маршрута по меткам (история 140). */
export type LegKind = 'train' | 'unicycle' | 'unknown';
/**
 * Участок между соседними метками. Диапазон fromIdx..toIdx — индексы route.points (= journeyWaypoints): по нему позже
 * можно вырезать участок или страну (история 151). straightKm — расстояние по прямой между метками, не длина пути.
 */
export interface JourneyLeg { fromIdx: number; toIdx: number; kind: LegKind; confidence: EvidenceConfidence; straightKm: number }
/** Смена вида передвижения: с метки fromIdx начинается серия участков одного вида (до toIdx). */
export interface TransportChange { kind: LegKind; confidence: EvidenceConfidence; fromIdx: number; toIdx: number }
/**
 * `transport` — карточка смены транспорта (маршрут по меткам): `beat` у неё служебный (kind 'waypoint', без подписи),
 * текст и значок берутся из `transport`.
 */
export interface ActiveCard { beat: Beat; alpha: number /* 0..1 */; enter: number /* 0..1 анимация появления */; transport?: TransportChange; chapter?: Chapter }
export interface FrameStats {
  distanceKm: number; progress: number;      // 0..1 по маршруту
  day?: number; date?: number; altitudeM?: number; speedKmh?: number;
  country: Country | null; place: Place | null;
}
export interface FrameState {
  shot?: ShotState;
  chapterMood?: ChapterMoodState;
  finalChapter?: Chapter;
  t: number; act: 'intro' | 'journey' | 'outro';
  head: number;                 // дробный индекс в route.points (i + доля к i+1)
  headLonLat: [number, number];
  camera: CameraState;
  stats: FrameStats;
  cards: ActiveCard[];
  introAlpha: number; outroAlpha: number;  // заголовок интро / итоговая карточка
  showFinish: boolean;
  /** Последняя смена страны на плашке (в путешествии и финале): оверлей анимирует её от `t - at`, без состояния между кадрами. */
  countryChange?: { from: Country | null; to: Country | null; at: number };
  /** Последняя смена «рядом» (города): `visible` — есть ли что показывать; анимация от `t - at`. */
  placeChange?: { at: number; visible: boolean };
}

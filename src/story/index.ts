// История ролика: темп, биты, камера (чистый модуль: без DOM, window, fetch).
//
// Камера (CameraState) для рендера:
//   center, zoom — относительно CSS-размера MAP_VIEWPORT[format] (тайл 512, как у MapLibre);
//   pitch — ДОЛЯ 0..1 от наклона стиля: рендер ставит map.pitch = camera.pitch * STYLES[styleId].pitch
//           (интро и финал — 0, сверху; путешествие — 1; переходы плавные);
//   bearing — всегда 0 (север вверху), рендер может прибавить свой поворот стиля, если он есть.
export { ACTS, OUTRO_HOLD_SEC, READ_LONG_SEC, READ_MIN_SEC, buildTimeline, type Timeline, type TimelineOptions } from './timeline';
export { fitBounds, type Padding } from './mercator';
export { factsAt, isWaypointRoute, journeyFacts, type JourneyFacts } from './legs';

export { matchChapters, type MatchedChapter } from './chapters';

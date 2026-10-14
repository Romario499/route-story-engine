// Публичный интерфейс импорта и обработки маршрута (чистый модуль: без DOM, window, fetch).
export { ROUTE_ERRORS } from './errors';
export { parseRouteText } from './parse';
export { parseRouteFiles } from './files';
export { buildRoute } from './build';
export { summarizeKmlImport, buildWaypointRoute, requiresWaypointSelection, waypointCollectionKey, WAYPOINT_ARCHIVE_SPAN_DAYS, WAYPOINT_COLOR_SEMANTICS } from './waypoints';
export type { KmzOptions } from './kmz';

export { parseChapterFile, CHAPTER_FILE_ERROR } from './chapters';

export { createImportChoice, ORGANIC_TRIP_OVERNIGHT_THRESHOLD } from './import-choice';
export type { ImportKind, RouteImportChoice } from './import-choice';

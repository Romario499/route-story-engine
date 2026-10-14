// Тексты ошибок импорта — готовые фразы для пользователя (история 7 спецификации).
export const ROUTE_ERRORS = {
  unreadable: (detail: string): string => `Не удалось прочитать файл: ${detail}`,
  empty: 'В файле нет точек маршрута',
  unsupported: 'Формат не поддерживается — нужен GPX, KML, KMZ, GeoJSON или CSV',
  tooFew: 'Меньше 2 точек — нечего анимировать',
  antimeridian: 'Маршрут пересекает 180° меридиан — такие маршруты пока не поддерживаются',
} as const;

/** Внутреннее исключение парсеров: несёт готовый текст для пользователя. */
export class RouteParseError extends Error {}

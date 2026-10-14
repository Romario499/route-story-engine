// Второй пример: «Участок по меткам @wahrier» — огрублённая выборка из private/ (вне git, ADR 0010, история 143).
// Выборку в репозитории хранить нельзя (нет разрешения путешественника), поэтому кнопка есть только в dev:
// Vite отдаёт файл прямо из папки проекта; в сборке (GitHub Pages, vite preview) кнопки нет и файла нет.
import { t } from '../i18n';
import type { InfoKey, Route } from '../types';

/** Путь относительно страницы; файл делает `node scripts/waypoints-sample.mjs … --segment 2025-07-14 2025-08-26 --country UZ --out private/wahrier/<имя>`. */
export const WAYPOINT_SAMPLE_URL = './private/wahrier/waypoints-uz-2025-07-14-2025-08-26-t20.json';
export const WAYPOINT_SAMPLE_FILE_NAME = 'wahrier-waypoints-uz-2025-07-14-2025-08-26.json';
export const WAYPOINT_SAMPLE_AUTHOR = '@wahrier';
export const WAYPOINT_SAMPLE_LABEL = 'Пример: участок по меткам @wahrier';
export const WAYPOINT_SAMPLE_NOTE = 'по меткам Organic Maps, не GPS-трек';
export const WAYPOINT_SAMPLE_FAILED_MESSAGE =
  'Не удалось загрузить участок по меткам: выборка лежит в private/wahrier/ только у автора проекта. Соберите её скриптом scripts/waypoints-sample.mjs.';

/** Подписи показателей маршрута по меткам — те же, что в ролике (`label.nights`, `label.markDays`); у остальных маршрутов без изменений. */
export function waypointInfoLabel(key: InfoKey, label: string, route: Route | null): string {
  if (route?.source?.kind !== 'waypoints') return label;
  if (key === 'progress') return t('ru', 'label.nights');
  if (key === 'day') return t('ru', 'label.marks');
  return label;
}

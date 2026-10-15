// Словари текстов ролика RU/EN. Добавляя ключ в RU, добавь его и в EN — иначе не соберётся тип.

export type Vars = Record<string, string | number>;
export type Message = string | ((vars: Vars) => string);

/** Склонение по-русски: ruPlural(5, ['день', 'дня', 'дней']). */
export function ruPlural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
const enPlural = (n: number, one: string, many: string) => (Math.abs(n) === 1 ? one : many);
const num = (v: Vars) => Number(v.n ?? 0);

export const RU = {
  'attribution.colourAdjusted': 'цвет изменён',
  'attribution.data': 'данные',
  'film.recorded': 'GPS-линия из файла',
  'film.reconstruction': 'Линия из файла · реконструкция',
  'film.marks': 'Географические метки',
  'film.dem': 'DEM · вертикальный масштаб',
  'film.flat': 'плоская карта',
  'film.coordinate': 'Координата записи',
  'film.lastPoint': 'Последняя точка записи',
  'film.end': 'Конец записи',
  'film.summary': 'География записи',
  'import.chooseSegment': 'Выбрать участок для ролика',
  'import.bookmarkTimes': 'Время создания закладок — не даты посещения. Подтвердите состав ролика; исходный архив сохраняется целиком.',
  'import.dateSpan': (v: Vars) => `Время создания закладок: ${v.from} — ${v.to}`,
  'import.from': 'С', 'import.to': 'По', 'import.collections': 'Коллекции',
  'import.undated': (v: Vars) => `Включить метки без даты: ${v.n}`,
  'import.confirm': (v: Vars) => `Подтвердить: ${v.n} меток, ${v.nights} мест ночёвок`,
  'import.composition': (v: Vars) => `В ролике ${v.n} из ${v.total} меток файла · технических дублей: ${v.duplicates}`,
  'import.invalidPeriod': 'Проверьте период: «с» должно быть не позже «по».',
  'import.replace': 'Заменить файл',
  // подписи информационных элементов (InfoKey)
  'label.distance': 'Пройдено',
  'label.distanceWithGaps': 'Участки и разрывы',
  'label.day': 'День',
  'label.date': 'Дата',
  'label.country': 'Страна',
  'waypoints.countryLeg': (v: Vars) => `${v.from ?? ''} → ${v.to ?? ''}`,
  'label.city': 'Рядом',
  'label.nearMark': 'Рядом',
  'source.gps': 'GPS-трек',
  'source.organic-maps': 'по меткам Organic Maps',
  'source.traveler': 'со слов путешественника',
  'label.altitude': 'Высота',
  'label.speed': 'Скорость',
  'label.profile': 'Профиль высот',
  'label.progress': 'Маршрут',
  'label.nearby': 'рядом',
  /** Пометка расчётных значений реконструкции (дата, день, скорость): не измерены. */
  'mark.estimated': 'расчётно',
  // биты и маркеры
  'beat.start': 'Старт',
  'beat.finish': 'Финиш',
  /** Маршрут по меткам: город в радиусе от огрублённой метки — не место старта/финиша, только «рядом» (G90). */
  'beat.startNear': 'Старт · рядом',
  'beat.finishNear': 'Финиш · рядом',
  /** Подпись на карте; «рядом:», а не «рядом с»: название места не склоняется. */
  'beat.startNearPlace': 'Старт · рядом: {place}',
  'beat.finishNearPlace': 'Финиш · рядом: {place}',
  'waypoints.place': 'Метка',
  'import.otherColors': (v: Vars) => `Не включено: ${v.n} закладок других цветов`,
  'import.includeOtherColors': 'Включить и их',
  'import.orderConfirmed': 'Порядок создания закладок совпадает с маршрутом поездки',
  'beat.peak': 'Высшая точка',
  /** @deprecated нейтральная пометка разрыва — `gap`; ключ уйдёт вместе с последним использованием (таск 13). */
  'map.transfer': 'переезд',
  /** Участок без трека (разрыв): способ передвижения по данным не определяется. */
  'gap': 'разрыв трека',
  'gap.unknown': 'Разрыв записи · путь неизвестен',
  'day': 'День {n}',
  // интро
  'intro.untitled': 'Моё путешествие',
  // итоговая карточка: число рисует рендер, подпись — отсюда ({n} — для склонения)
  'summary.title': 'Итог поездки',
  'summary.distance': 'пройдено',
  'summary.recordedDistance': 'по записанным участкам',
  'summary.gapStraight': 'разрыв ≈ {km} по прямой',
  'summary.days': (v: Vars) => ruPlural(num(v), ['день', 'дня', 'дней']),
  'summary.countries': (v: Vars) => ruPlural(num(v), ['страна', 'страны', 'стран']),
  'summary.maxAltitude': 'макс. высота',
  'summary.byTrack': 'по треку {km}',
  'summary.gaps': 'разрывы {km}',
  /** @deprecated заменён `summary.byTrack` / `summary.gaps`; удалить, когда overlay.ts перестанет читать (таск 13). */
  'summary.transfers': 'в т. ч. переезды {km}',
  /** @deprecated см. `summary.transfers`. */
  'summary.own': 'своим ходом {km}',
  // названия стилей (для карточек выбора и подписей)
  'style.epic': 'Экспедиция',
  'style.atlas': 'Атлас',
  'style.neon': 'Неон',
  // подпись примера
  'note.reconstruction': 'реконструкция маршрута',
  // маршрут по меткам (ADR 0010): метки путешествия, а не GPS-трек
  /** Постоянная подпись кадра: пунктир между метками — не записанный путь. */
  'note.waypoints': 'маршрут по меткам, не GPS-трек',
  'note.geographicOverview': 'обзор по меткам',
  'overview.countries': (v: Vars) => `${v.n} ${ruPlural(num(v), ['страна', 'страны', 'стран'])}`,
  'label.nights': 'Места ночёвок',
  'label.markDays': 'Метки',
  'label.marks': 'Метки',
  'summary.marks': (v: Vars) => ruPlural(num(v), ['метка', 'метки', 'меток']),
  'import.waypointHint': 'Метки Organic Maps — не GPS-трек. Порядок показа не доказывает хронологию поездки; пунктир — связь меток, не записанная дорога. Время закладки — не дата визита.',
  'mark.byMarks': 'по меткам',
  'transport.change': 'Смена транспорта',
  'transport.train': 'Поезд',
  /** Предположение по меткам (шаг между ночёвками), не факт. */
  'transport.unicycle': 'Уницикл · предположительно',
  'transport.unknown': 'Способ неизвестен',
  'summary.overnightPlaces': (v: Vars) => ruPlural(num(v), ['место ночёвки', 'места ночёвки', 'мест ночёвки']),
  'summary.nights': (v: Vars) => ruPlural(num(v), ['ночёвка', 'ночёвки', 'ночёвок']), // legacy; кадр по меткам этот ключ не использует
} satisfies Record<string, Message>;

export type OverlayKey = keyof typeof RU;

export const EN: Record<OverlayKey, Message> = {
  'attribution.colourAdjusted': 'colour adjusted',
  'attribution.data': 'data',
  'film.recorded': 'GPS line from file',
  'film.reconstruction': 'Line from file · reconstruction',
  'film.marks': 'Geographic bookmarks',
  'film.dem': 'DEM · vertical scale',
  'film.flat': 'flat map',
  'film.coordinate': 'Recorded coordinate',
  'film.lastPoint': 'Last recorded point',
  'film.end': 'End of recording',
  'film.summary': 'Recorded geography',
  'import.chooseSegment': 'Choose a segment for the video',
  'import.bookmarkTimes': 'Bookmark creation times are not visit dates. Confirm the video contents; the entire source archive is retained.',
  'import.dateSpan': (v: Vars) => `Bookmark creation times: ${v.from} — ${v.to}`,
  'import.from': 'From', 'import.to': 'To', 'import.collections': 'Collections',
  'import.undated': (v: Vars) => `Include undated waypoints: ${v.n}`,
  'import.confirm': (v: Vars) => `Confirm: ${v.n} waypoints, ${v.nights} overnight places`,
  'import.composition': (v: Vars) => `${v.n} of ${v.total} file waypoints in the video · technical duplicates: ${v.duplicates}`,
  'import.invalidPeriod': 'Check the period: “from” must be no later than “to”.',
  'import.replace': 'Replace file',
  'label.distance': 'Distance',
  'label.distanceWithGaps': 'Sections and gaps',
  'label.day': 'Day',
  'label.date': 'Date',
  'label.country': 'Country',
  'waypoints.countryLeg': (v: Vars) => `${v.from ?? ''} → ${v.to ?? ''}`,
  'label.city': 'Near',
  'label.nearMark': 'Near',
  'source.gps': 'GPS track',
  'source.organic-maps': 'from Organic Maps waypoints',
  'source.traveler': 'as told by the traveler',
  'label.altitude': 'Altitude',
  'label.speed': 'Speed',
  'label.profile': 'Elevation',
  'label.progress': 'Route',
  'label.nearby': 'nearby',
  'mark.estimated': 'estimated',
  'beat.start': 'Start',
  'beat.finish': 'Finish',
  'beat.startNear': 'Start · near',
  'beat.finishNear': 'Finish · near',
  'beat.startNearPlace': 'Start · near {place}',
  'beat.finishNearPlace': 'Finish · near {place}',
  'waypoints.place': 'Waypoint',
  'import.otherColors': (v: Vars) => `Not included: ${v.n} bookmarks of other colors`,
  'import.includeOtherColors': 'Include them too',
  'import.orderConfirmed': 'Bookmark creation order matches the trip route',
  'beat.peak': 'Highest point',
  'map.transfer': 'transfer',
  'gap': 'track gap',
  'gap.unknown': 'Recording gap · path unknown',
  'day': 'Day {n}',
  'intro.untitled': 'My journey',
  'summary.title': 'Trip summary',
  'summary.distance': 'travelled',
  'summary.recordedDistance': 'along recorded sections',
  'summary.gapStraight': 'gap ≈ {km} in a straight line',
  'summary.days': (v: Vars) => enPlural(num(v), 'day', 'days'),
  'summary.countries': (v: Vars) => enPlural(num(v), 'country', 'countries'),
  'summary.maxAltitude': 'max altitude',
  'summary.byTrack': 'along the track {km}',
  'summary.gaps': 'gaps {km}',
  'summary.transfers': 'incl. transfers {km}',
  'summary.own': 'on own power {km}',
  'style.epic': 'Expedition',
  'style.atlas': 'Atlas',
  'style.neon': 'Neon',
  'note.reconstruction': 'route reconstruction',
  'note.waypoints': 'route from waypoints, not a GPS track',
  'note.geographicOverview': 'waypoint overview',
  'overview.countries': (v: Vars) => `${v.n} ${enPlural(num(v), 'country', 'countries')}`,
  'label.nights': 'Overnight places',
  'label.markDays': 'Waypoints',
  'label.marks': 'Waypoints',
  'summary.marks': (v: Vars) => enPlural(num(v), 'waypoint', 'waypoints'),
  'import.waypointHint': 'Organic Maps waypoints are not a GPS track. Presentation order is not trip chronology; dotted links are not recorded roads. Bookmark times are not visit dates.',
  'mark.byMarks': 'by waypoints',
  'transport.change': 'Change of transport',
  'transport.train': 'Train',
  'transport.unicycle': 'Unicycle · inferred',
  'transport.unknown': 'Mode unknown',
  'summary.overnightPlaces': (v: Vars) => enPlural(num(v), 'overnight place', 'overnight places'),
  'summary.nights': (v: Vars) => enPlural(num(v), 'night', 'nights'), // legacy
};

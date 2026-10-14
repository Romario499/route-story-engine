# Архитектура

Клиентское приложение без бэкенда (ADR 0001): файл маршрута → ролик MP4/WebM, всё в браузере.

## Поток данных

файлы → `route` (импорт) → `Route` (`track` | `waypoints`) → `geo` → `story` (таймлайн, главы) → `render` → `export`

- `src/route/files.ts`: `parseRouteFiles(files, options?)` читает набор файлов за один выбор: GPX/KML/KMZ/GeoJSON/CSV, огрублённую выборку по меткам (`parseWaypointSample`) и файл глав `chapters.json` (`parseChapterFile`). Результат — `ParseResult { tracks, warnings, report?, chapters? }`. Ошибка файла глав не валит импорт: предупреждение, ролик без глав.
- Два способа получить `Route` из `RawTrack[]` (`src/route/index.ts`):
  - `buildRoute` — GPS-трек: очистка выбросов, переезды, статистика, упрощение для отрисовки;
  - `buildWaypointRoute` — маршрут по меткам (ADR 0010): точки — закладки (`Route.journeyWaypoints`), `totalM = 0`, `hasTime = false`, километража нет. Признак — `Route.source.kind === 'waypoints'` (читать через `isWaypointRoute` из `src/story`).
- Бэкап Organic Maps с линией и метками одновременно даёт выбор: `createImportChoice(tracks)` строит обе версии (`track`, `waypoints`) и по умолчанию берёт метки при ≥ 10 ночёвках. Выбор лежит в `store.source.importChoice`; `selectImportKind` подменяет `route` в store, сохраняя главы (`src/ui/step-route.ts`).
- `src/geo`: `loadGeoData` (статика `public/data/*.json`) → `createGeoIndex` → `enrichRoute(route, geo)` → `Enrichment` (страны, ближайший город, биты). Запускается из `src/ui/enrich.ts` при появлении маршрута без `enrichment`; без гео-файлов история строится, но без стран и городов.
- `src/story`:
  - `buildTimeline(route, enrichment, settings, opts)` → `frameAt(t)` → `FrameState` (акт, «голова», камера, статистика, карточки). Опции берутся из `timelineOptionsFor(format, styleId)` (`render/layout.ts`). Темп по расстоянию; у маршрута по меткам — по `waypointPacingRoute` и участкам `legs.ts` (поезд / одноколёсник по оценке / неизвестно), ночёвки и «день по меткам» — `journeyFacts`.
  - Главы: `matchChapters(route, enrichment)` сопоставляет `Chapter.anchor` (страны ISO, регион, диапазон меток) с маршрутом; совпавшие добавляют паузу на чтение, карточку `ActiveCard.chapter` и «настроение» кадра (`FrameState.chapterMood`, тон — `chapterToneFor`). Не совпало — молча пропускается; у трека глав нет.
- `src/render`: `createScene(host, { format, styleId, pixelRatio })`; `scene.render(frame, ...)` ставит камеру MapLibre и рисует 2D-слой через проекцию карты (ADR 0003): `track.ts` (линия трека либо `waypoint-layer.ts` для меток — пунктир/дуги по виду участка, без сплошной линии), `drawOverlay` (плашки, цифры, карточки, главы). MapLibre отвечает только за подложку и рельеф.
- `src/export`: `exportVideo` создаёт свою скрытую сцену и идёт по кадрам 0..N на 30 fps, на каждом ждёт тайлы, кодирует через WebCodecs и мультиплексирует в MP4 (H.264) или WebM (ADR 0002).
- Превью (`src/ui/step-preview.ts`) строит тот же `Timeline` и ту же сцену с `pixelRatio 1`; состояние приложения — один store в `src/ui/state.ts` (`route`, `enrichment`, `settings`, `status`, `source`).

## Границы модулей

- `src/types.ts` — единственное место общих форм данных; модули друг другу отдают только их.
- `route`, `geo/index.ts`, `story`, `i18n` — чистые: без DOM, `window`, `fetch`. Браузерное (`geo/load.ts`, `render`, `export`, `ui`) не просачивается в них. Исключение по зависимостям: `route/waypoints.ts` использует `story/legs.ts` для отчёта об участках.
- Всё, что зависит от вида маршрута (трек/метки), ветвится по `isWaypointRoute`: `story/timeline.ts`, `render/track.ts`, `render/overlay.ts`, `ui/step-route.ts`, `ui/studio/controls.ts`. Новый потребитель длины, скорости, времени или высоты обязан проверить вид маршрута.
- `render` не знает про UI и экспорт; `export` не знает про UI — панель экспорта (`src/ui/export-panel.ts`) только передаёт ему данные и `AbortSignal`.
- Тексты ролика — только `src/i18n/`; тексты интерфейса — по-русски в `src/ui/`.

## Приватность и dev-only

- Реальные метки, выборки, главы и треки не входят в репозиторий: `private/` (метки @wahrier, `chapters.json`, выборки) и `tracks/` (чужие GPX) в `.gitignore`. В `public/` лежат только обезличенное: схема глав, `fictional-chapters.json`, пример-реконструкция.
- Выборка участка по меткам: `scripts/waypoints-sample.mjs` (период + страна/рамка + огрубление до 0,1°, без названий и путей; ADR 0012). Читается в приложении только в dev: кнопка «Пример: участок по меткам @wahrier» и подхват `private/wahrier/chapters.json` под `import.meta.env.DEV`; в сборке для Pages их нет. Тесты используют синтетику из `tests/fixtures/synthetic/`.
- Ролик не называет город посещённым: у меток только «рядом» (ADR 0013). Времена меток — моменты закладок, не визитов.
- Главы подключаются файлом (схема `public/samples/chapters.schema.json`), редактора и медиа автора нет (ADR 0011, 0014).
- Перед публикацией репозитория нужна очистка истории от воспоминаний путешественника — см. `AGENTS.md`.

## Соглашения

- Дизайн-пиксели: 9:16 = 1080×1920, 16:9 = 1920×1080 (`DESIGN_SIZE`); `drawOverlay` и `layout.ts` работают в них.
- Контейнер карты в CSS-пикселях — половина дизайна, `MAP_VIEWPORT` (540×960 / 960×540); зум и центр камеры всегда относительно него.
- Холст сцены = дизайн × `pixelRatio / 2`. Экспорт — `pixelRatio: 2` (холст ровно размера файла), превью — 1 и уменьшается `transform: scale()`.
- `CameraState.pitch` — доля 0..1; рендер ставит `map.pitch = camera.pitch * STYLES[id].pitch`. `bearing` всегда 0.
- `timelineOptionsFor(format, styleId)` (`src/render/layout.ts`) — единственный источник отступов общего плана и зоны показателей; превью и экспорт обязаны брать опции оттуда.
- `preloadOverlayAssets(enrichment)` (`src/render/assets.ts`) — флаги грузятся лениво; превью и экспорт ждут её до первого кадра.
- Анимация смены плашки страны ведётся по `frame.t` на `ctx` сцены: кадры подавать по порядку, скачок времени > 0,5 с сбрасывает анимацию. Всё остальное в кадре вычисляется только от `frame.t` и данных (детерминизм перемотки).
- FPS = 30 везде; название файла экспорта строится из `resolveTitle(...)`.
- Файлы держать в LF (`.gitattributes`).

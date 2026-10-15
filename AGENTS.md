# Route Story Engine — GPS-трек или метки Organic Maps → ролик 9:16 / 16:9 (Vite + TypeScript strict, без бэкенда и UI-фреймворка)

Ветка работы — `master`; remote не настроен, Pages-деплой срабатывает на `main`. Нужны Node ≥ 22.18 (скрипты читают `.ts` напрямую; проверено на 24.15), установленный Edge (e2e, экспорт); Windows PowerShell — `npm.cmd`/`npx.cmd`.

## Команды

| Команда | Что делает |
|---------|------------|
| `npm ci` | установить зависимости (пишет «1 critical» от `maplibre-gl@4.7.1` — осознанно, ADR 0007) |
| `npm run dev` | Vite на :5173 (другой порт: `npm run dev -- --port 5199 --strictPort`) |
| `npm run build` | `tsc --noEmit && vite build` → `dist/`; предупреждение `INEFFECTIVE_DYNAMIC_IMPORT` у `src/render/scene.ts` — норма |
| `npm run preview -- --port 4174 --strictPort` | отдать `dist/` (нужна сборка) |
| `npm test` | Vitest, все юниты |
| `npx vitest run tests/route/parse.test.ts` | один тестовый файл |
| `npm run check` | `tsc --noEmit` + `vitest run` (то же гоняет CI перед деплоем); сейчас 75 файлов, 842 passed |
| `npm run test:e2e` | Playwright в настоящем Edge (`channel: 'msedge'`; Chrome: `RS_E2E_CHANNEL=chrome`); сам делает `npm run build` и поднимает `vite preview` :4173; 28 тестов; иногда зависает на остановке preview уже после зелёного прогона |
| `npm run exports` | снимает `exports/redesign/*.mp4` через UI (Edge, интернет, 2–4 мин на файл) — см. «Подводные камни» про перезапись |
| `npm run build:geodata` / `npm run build:sample` | пересобирают `public/data/*.json` и пример GPX; ходят в сеть, результат закоммичен — не запускать без нужды |
| `node scripts/waypoints-sample.mjs <файл.kmz> --report` | сводка по бэкапу Organic Maps без координат; выборка участка: `--segment <YYYY-MM-DD> <YYYY-MM-DD> [--country ISO2 \| --bbox minLon minLat maxLon maxLat] [--out private/wahrier/<имя>.json]` (не перезаписывает существующий файл) |
| `node scripts/make-style-thumbs.mjs` | пересъёмка `public/style-thumbs/*.webp` (сам поднимает dev, Edge, интернет) |
| `node tests/render/terrain-zoom-probe.mjs <файл.gpx>` | проба MapLibre на зуме 13+ покадрово; перед этим `npm run dev -- --port 5182 --strictPort`; пример: `tests/fixtures/track.gpx` |
| `node tests/render/styles-frames.mjs <папка>` | PNG-кадры трёх стилей; тоже нужен dev на :5182 |
| `node tests/render/fonts-probe.mjs` | проба строгой загрузки шрифтов в Edge (сам собирает, порт 4176) |

## Где что лежит

- `src/types.ts` — общие типы и константы (`Route`, `Chapter`, `FrameState`, `FPS`, `DESIGN_SIZE`, `MAP_VIEWPORT`); любая новая общая форма данных — сюда.
- `src/route/` — импорт: `files.ts` (набор файлов → `ParseResult`, в т.ч. KMZ и файл глав), `parse.ts`/`gpx|kml|kmz|csv|geojson.ts`, `build.ts` (`buildRoute` = трек), `waypoints.ts` (`buildWaypointRoute` = маршрут по меткам), `import-choice.ts`, `chapters.ts`, `waypoint-sample.ts`.
- `src/route/import-choice.ts` — `createImportChoice(tracks)`: только для бэкапа Organic Maps, где есть и линия, и метки; даёт обе версии маршрута (`track`/`waypoints`), по умолчанию `waypoints` при ≥ 10 ночёвках (`ORGANIC_TRIP_OVERNIGHT_THRESHOLD`). Переключатель «Трек · Метки путешествия» — `selectImportKind` в `src/ui/step-route.ts`, `data-testid` `import-track|import-waypoints`.
- `src/geo/index.ts`, `src/story/`, `src/i18n/` — чистые модули (без DOM/`window`/`fetch`); браузерное — `src/geo/load.ts`. `route/` тоже чистый, но `route/waypoints.ts` тянет `story/legs.ts`.
- `src/story/legs.ts` — участки между метками, ночёвки, `isWaypointRoute(route)` (развилка «трек/метки» во всех слоях); `src/story/chapters.ts` — привязка глав и «настроение»; `timeline.ts` — акты и темп.
- `src/render/` — всё, что рисует кадр: `scene.ts` (MapLibre + холст), `track.ts` (линия, подписи), `waypoint-layer.ts` (пунктир/дуги по участкам меток), `overlay.ts` (2D-слой), `layout.ts` (зоны, отступы, `timelineOptionsFor`), `styles.ts` (стили, `chapterToneFor`), `fonts.ts`, `assets.ts` (флаги).
- `src/export/` — WebCodecs + muxer, кадр за кадром (`index.ts`, `support.ts`, `mux.ts`, `errors.ts`, `messages.ts`); UI панели — `src/ui/export-panel.ts`.
- `src/ui/` — страница: `state.ts` (store), `step-route.ts` (импорт, примеры, сводка), `step-style.ts`, `step-preview.ts`, `enrich.ts`, `waypoint-sample.ts`, `studio/`; точка входа `src/main.ts`; стабильные `data-testid` для e2e живут здесь.
- Главы: схема `public/samples/chapters.schema.json`, обезличенный пример `public/samples/fictional-chapters.json`; настоящие — `private/wahrier/chapters.json`, подхватываются только в dev (ADR 0011).
- `tests/<модуль>/` — юниты зеркально `src/`; `tests/fixtures/` (+ `synthetic/` — обезличенные GPX/KML и `organic-mixed.ts`); `tests/e2e/` — Playwright (`flow.ts` общий со `scripts/make-exports.mjs`).
- Материалы приёмки: `tests/e2e/materials.mjs` (общие хелперы; тяжёлые кадры — в `RS_T15_SCRATCH`, по умолчанию `%TEMP%/route-story-t15`), `acceptance-materials.mjs` (`node tests/e2e/acceptance-materials.mjs ui|frames|data|local|chapters`, dev на :5184; `local`/`chapters` читают `private/wahrier/`), `finalize-materials.mjs`, `make-review-sheets.mjs`; результат — `docs/visual-review/`, `exports/redesign/`.
- `public/data/`, `public/samples/` — офлайн-география и пример маршрута @wahrier (статика, `base: './'`); `exports/*.mp4` старые — под защитой хешей в `make-exports.mjs`.
- `.gitattributes` — `* text=auto eol=lf` + бинарные расширения (иначе чистый клон с `autocrlf=true` валит `npm run check`).

## Подводные камни

- Экспорт работает только в Chrome/Edge (WebCodecs); вкладку на время экспорта не сворачивать.
- `npm run exports` НЕ перезаписывает существующий `exports/redesign/<файл>.mp4`: падает с «перезапись не разрешена». `RS_EXPORT_REVIEW_EXISTING=1` только перепроверяет и пересчитывает `.json` рядом с готовым файлом; чтобы переснять — удалить файл (с подтверждением владельца). `RS_EXPORT_ONLY=<подстрока имени>` — снять часть матрицы. Старые `exports/route-story-wahrier-*.mp4` скрипт не должен менять (сверяет хеши).
- Тексты внутри ролика — только через `src/i18n/` (RU/EN), строк в рендере быть не должно.
- Экспорт и превью обязаны брать опции из `timelineOptionsFor(format, styleId)` (`layout.ts`) и ждать `preloadOverlayAssets(enrichment)` до первого кадра (иначе кадр без флагов).
- Кадры в экспорте подавать строго по порядку на одном `ctx` сцены: анимация плашки страны завязана на `frame.t`.
- Маршрут по меткам (`route.source?.kind === 'waypoints'`) — НЕ трек: `totalM = 0`, `hasTime = false`, километража нет. Любому потребителю `totalM`/`distanceKm`/`speedKmh` сначала проверять `isWaypointRoute`. Время метки — момент создания закладки, не дата визита (ADR 0010); город у меток — только «рядом» (ADR 0013).
- В `summarizeKmlImport` (`route/waypoints.ts`) для Organic Maps зашито «семя» старта: первая зелёная метка с 2024-11 в рамке Турции; выборка участка (`parseWaypointSample`) его обходит явным периодом (ADR 0012).
- Главы показываются, только если `anchor` совпал со странами/метками загруженного маршрута; несовпавшие молча пропускаются. Редактора глав и медиа автора нет (ADR 0011, 0014).
- CARTO-тайлы требуют ключ (водяной знак) — не возвращать; подложка «Неон»/«Атлас» — OpenFreeMap (ADR 0004). Других сетевых обращений в рантайме быть не должно.
- `scene.ts` лезет в приватное `map.style.sourceCaches` MapLibre 4.7.1 (`hasErroredTiles`, `guardTerrainTileCache` и запись `map.terrain.exaggeration` в `placeCamera` — обход бага terrain + `clearFadeHold` на зуме 13+, ADR 0009) — при обновлении `maplibre-gl` проверить первым; проверка — dev на :5182 и `node tests/render/terrain-zoom-probe.mjs <горный.gpx>` (локально — `tracks/triglav.gpx`; `tracks/` вне git, в чистом клоне его нет).
- Dev-only: кнопка «Пример: участок по меткам @wahrier» (`load-sample-waypoints`) и `window.__rs` существуют только при `import.meta.env.DEV`; в `build`/`preview` их нет, e2e этого примера идёт на синтетике через свой Vite на :5199.
- Windows/CRLF: файлы держать в LF (`.gitattributes` приведёт при коммите, но редакторы пишут CRLF).
- Зависимости не добавлять без причины; `.env*` не трогать (в проекте их нет и не нужно).

## Окружение

Переменных окружения для приложения нет: ключей, аккаунтов и бэкенда в проекте нет (деплой — GitHub Pages из `main`, `.github/workflows/deploy.yml`: `npm ci` → `npm run check` → `npm run build`). Необязательные переменные скриптов: `RS_E2E_CHANNEL`, `RS_E2E_HEADED=1`, `RS_EXPORT_ONLY`, `RS_EXPORT_REVIEW_EXISTING`, `RS_T15_SCRATCH`, `RS_V3_REFS`, `RS_FRAMES_URL`, `RS_THUMBS_URL`, `RS_BEFORE_URL`.

Подробнее: `docs/architecture.md` (поток данных, границы модулей, приватность), `docs/adr/` (почему решено так; 0010–0014 — метки, главы, выборка, города, медиа), `CONTEXT.md` (язык предметной области: «голова», «переезд», «бит», «акт», «метка», «ночёвка»).

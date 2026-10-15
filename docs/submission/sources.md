# Источники данных и лицензии

Проверено 15.10.2026. Это сверка опубликованных условий, а не юридическое заключение. В кадре ролика — краткая атрибуция (место ограничено форматом 9:16); полный текст — здесь.

## Что видно в кадре стиля «Экспедиция»

| Слой | Источник / сервис | Лицензия и условия | Требуемая атрибуция | Изменения у нас |
|---|---|---|---|---|
| Спутниковый снимок | **EOxCloudless 2016** (Sentinel-2 cloudless), слой WMTS `s2cloudless_3857`, `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg` | **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/) — подтверждено двумя первоисточниками EOX: Abstract слоя в `WMTSCapabilities.xml` и страница https://cloudless.eox.at/license-non-commercial («For the year 2016, EOxCloudless is licensed under the Creative Commons Attribution 4.0 International License»; ограничение «некоммерческое» там относится к 2018–2025). Доступ без ключа и платы, атрибуция обязательна «legibly and in proximity to the usage»; сервис «as-is», SLA нет, возможен rate limiting | «EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)» + CC BY 4.0 со ссылкой (формулировка страницы лицензии EOX) | цвет (насыщенность, контраст, яркость), прозрачность поверх отмывки рельефа, перспективная проекция на DEM, кадрирование |
| Рельеф (3D и отмывка) | **AWS Terrain Tiles** (Tilezen/Mapzen, формат terrarium), `s3.amazonaws.com/elevation-tiles-prod/terrarium` | открытые данные; атрибуция источников высот «in a place that is reasonable to the medium» (Tilezen `docs/attribution.md`); реестр AWS просит ссылку «Terrain Tiles was accessed on ДАТА from https://registry.opendata.aws/terrain-tiles» (в титрах видео) | для Европы: «Europe terrain data produced using Copernicus data and information funded by the European Union — EU-DEM layers»; «United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey»; «Global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration» | вертикальный масштаб ×E (подписан в кадре), отмывка, перспектива |
| Подписи, дороги, реки, границы | **OpenFreeMap** (сервис) · **OpenMapTiles** (схема) · **OpenStreetMap** (данные) | данные OSM — ODbL 1.0 (https://www.openstreetmap.org/copyright); схема OpenMapTiles — CC BY 4.0; OpenFreeMap — бесплатно, без ключа, «как есть» (https://openfreemap.org/tos/) | «OpenFreeMap © OpenMapTiles Data from OpenStreetMap» | стилизация цветом и прозрачностью |

Строка атрибуции в кадре: `EOxCloudless 2016 https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017), CC BY 4.0 https://creativecommons.org/licenses/by/4.0/, цвет изменён · OpenFreeMap © OpenMapTiles Data from OpenStreetMap · Terrain Tiles on AWS (SRTM, USGS, NOAA, Copernicus EU-DEM)` — фактический текст см. в [src/render/styles.ts](../../src/render/styles.ts). Старые контактные листы не подтверждают финальные ролики; статус их проверки — в [test-results.md](test-results.md).

**Esri World Imagery больше не используется** ни в одном стиле: по опубликованным условиям Esri слой допустим только с ПО Esri или подпиской ArcGIS Online, которых у проекта нет (ADR 0008).

## Прочее в кадре и в приложении

| Что | Источник | Версия | Лицензия |
|---|---|---|---|
| Границы стран, города | Natural Earth (`ne_50m_admin_0_countries`, `ne_10m_populated_places`) из `nvkelso/natural-earth-vector` | на дату сборки `public/data` | public domain (https://www.naturalearthdata.com/about/terms-of-use/) |
| Флаги стран | `flag-icons` | 7.5.0 | MIT |
| Шрифты | Manrope (google/fonts), PT Serif, JetBrains Mono (`@fontsource/*` 5.3.0) | см. `src/assets/fonts/LICENSES.md` | SIL OFL 1.1 |
| Движок карты | MapLibre GL JS | 4.7.1 | BSD-3-Clause |
| Музыка, фото, логотипы | не используются | — | — |

## Маршрут роликов подачи

| Данные | Происхождение | Статус прав |
|---|---|---|
| **Путешествие @wahrier** по меткам Organic Maps, Турция → Узбекистан; главы со слов путешественника | сам путешественник | публикация производных роликов **разрешена путешественником** (подтверждено владельцем проекта 15.10.2026). Исходные файлы маршрута, координаты и тексты глав в репозиторий не входят |

Метки Organic Maps — не GPS-трек ([ADR 0010](../adr/0010-waypoints-not-a-track.md)): в роликах нет километража и скорости, время метки — момент создания закладки, а не дата визита; порядок участков — по времени закладок и показывается только после явного подтверждения порядка; транспорт участков — по отметке автора либо «неизвестно».

Проверенные и отклонённые сторонние источники (15.10.2026):
- Hong Kong Trails GPX/KML (GitHub, CC0) — по описанию автора геометрия выгружена из OpenStreetMap, высоты из ASTER GDEM: это не GPS-записи; данные OSM — ODbL.
- Hikr.org GPX (Kaggle, метка CC0) и CC-GPX (Common Crawl) — треки собраны с сайтов; права авторов треков агрегатором не подтверждены.

Доказательства: [слепок WMTSCapabilities EOX от 15.10.2026](evidence/eox-WMTSCapabilities-2026-10-15.xml) и [выдержка лицензии](evidence/eox-license-excerpt.md).

Полные титры для описания каждого видео — [video-credits.md](video-credits.md). Уведомления о лицензиях пакетов (flag-icons MIT, MapLibre BSD-3-Clause, шрифты OFL 1.1) — [public/THIRD-PARTY-NOTICES.txt](../../public/THIRD-PARTY-NOTICES.txt) (входит в сборку сайта).

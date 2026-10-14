// Обогащение маршрута (страны, города, сюжетные биты): как только в состоянии появляется маршрут без
// enrichment, грузим офлайн-гео и считаем. Если гео-файлы не загрузились — история всё равно строится
// (старт, финиш, высшая точка, остановки), только без стран и городов.
import { enrichRoute, type GeoIndex } from '../geo';
import { loadGeoData } from '../geo/load';
import type { AppState, Store } from './state';

const emptyGeo: GeoIndex = { countryAt: () => null, nearestPlace: () => null };
let geoPromise: Promise<GeoIndex> | null = null;

function getGeo(): Promise<GeoIndex> {
  if (!geoPromise) {
    geoPromise = loadGeoData().catch((err) => {
      console.warn('Гео-данные не загрузились, страны и города не будут определены:', err);
      geoPromise = null; // при следующем маршруте попробуем снова
      return emptyGeo;
    });
  }
  return geoPromise;
}

export const ENRICH_FAILED_MESSAGE = 'Не удалось определить страны и города маршрута. Попробуйте загрузить файл ещё раз или выберите другой.';

type Loaded = Pick<AppState, 'route' | 'enrichment' | 'source'>;

export function attachEnrichment(store: Store): void {
  let pending: unknown = null;
  // последний маршрут, который удалось обогатить: к нему возвращаемся, если новый обработать не вышло
  let lastGood: Loaded | null = store.get().route && store.get().enrichment
    ? { route: store.get().route, enrichment: store.get().enrichment, source: store.get().source }
    : null;
  const run = async () => {
    const { route, enrichment } = store.get();
    if (!route || enrichment || pending === route) return;
    pending = route;
    const geo = await getGeo();
    if (store.get().route !== route) return; // за это время загрузили другой маршрут
    try {
      const enriched = enrichRoute(route, geo);
      lastGood = { route, enrichment: enriched, source: store.get().source };
      store.set({ enrichment: enriched });
    } catch (err) {
      console.error('Не удалось обогатить маршрут:', err);
      // прошлый маршрут остаётся, превью не зависает на «Готовлю карту…»
      store.set({
        ...(lastGood ?? { route: null, enrichment: null, source: null }),
        status: { phase: 'error', message: ENRICH_FAILED_MESSAGE },
      });
    }
  };
  store.subscribe(() => { void run(); });
  void run();
}

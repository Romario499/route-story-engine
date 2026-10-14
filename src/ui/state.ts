// Единое состояние приложения { route, enrichment, settings, status } и простое хранилище с подписками.
import type { RouteImportChoice } from '../route';
import type { Enrichment, Route, StorySettings, WaypointArchive, WaypointSelection } from '../types';

export type AppStatus =
  | { phase: 'idle' }
  | { phase: 'loading'; message: string }
  | { phase: 'ready' }
  | { phase: 'error'; message: string }; // готовый русский текст; прошлый маршрут при этом остаётся

/** Откуда загружен текущий маршрут. */
export interface RouteSource {
  files: string[]; warnings: string[];
  /** Встроенный пример: трек восстановлен по афише, а не записан GPS (метка в UI и «расчётно» у дня/даты/скорости). */
  reconstruction?: boolean;
  importChoice?: RouteImportChoice;
  waypointArchive?: WaypointArchive;
  waypointSelection?: WaypointSelection;
}

export interface AppState {
  route: Route | null;
  enrichment: Enrichment | null;
  settings: StorySettings;
  status: AppStatus;
  source: RouteSource | null;
}

export const DEFAULT_SETTINGS: StorySettings = {
  styleId: 'epic',
  format: '9:16',
  durationSec: 30,
  lang: 'ru',
  // по умолчанию — только то, что считается по геометрии: пройдено, прогресс, страна.
  // Высоту включает импорт файла пользователя, где она есть; день/дата/скорость выключены (история 80).
  info: {
    distance: true, day: false, date: false, country: true, city: false,
    altitude: false, speed: false, profile: false, progress: true,
  },
  title: '',
  author: '',
  showSafeZones: false,
};

export type Listener = (state: AppState, prev: AppState) => void;

export interface Store {
  get(): AppState;
  /** Поверхностно сливает patch в состояние и уведомляет подписчиков. */
  set(patch: Partial<AppState>): void;
  updateSettings(patch: Partial<StorySettings>): void;
  subscribe(listener: Listener): () => void;
}

export function createStore(initial: Partial<AppState> = {}): Store {
  let state: AppState = {
    route: null,
    enrichment: null,
    settings: { ...DEFAULT_SETTINGS, info: { ...DEFAULT_SETTINGS.info } },
    status: { phase: 'idle' },
    source: null,
    ...initial,
  };
  const listeners = new Set<Listener>();
  const store: Store = {
    get: () => state,
    set(patch) {
      const prev = state;
      state = { ...state, ...patch };
      for (const l of listeners) l(state, prev);
    },
    updateSettings(patch) {
      store.set({ settings: { ...state.settings, ...patch } });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

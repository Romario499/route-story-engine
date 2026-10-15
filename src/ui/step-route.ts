// Секция «Маршрут»: загрузка файлов (выбор и перетаскивание), компактная сводка, ошибки.
// Пусто → большая зона импорта; после загрузки → сводка одной строкой + «Заменить файл».
import { createImportChoice, buildRoute, buildWaypointRoute, requiresWaypointSelection, summarizeKmlImport, waypointCollectionKey, parseRouteFiles, parseRouteText } from '../route';
import { journeyFacts, matchChapters } from '../story';
import { sourceLabel, t } from '../i18n';
import type { ImportKind } from '../route';
import type { ParseResult, Route, WaypointArchive, WaypointSelection } from '../types';
import { h, icon } from './dom';
import { formatInt, formatKm, plural } from './format';
import { DEFAULT_SETTINGS, type AppState, type RouteSource, type Store } from './state';
import { createSection } from './studio/section';
import { routeFactsView } from './studio/route-facts';
import '../styles/waypoint-selection.css';
import {
  WAYPOINT_SAMPLE_AUTHOR, WAYPOINT_SAMPLE_FAILED_MESSAGE, WAYPOINT_SAMPLE_FILE_NAME, WAYPOINT_SAMPLE_LABEL, WAYPOINT_SAMPLE_NOTE,
  WAYPOINT_SAMPLE_URL,
} from './waypoint-sample';

const ACCEPT = '.gpx,.kml,.kmz,.geojson,.json,.csv,.txt,.xml';

/** Встроенный пример: реконструкция маршрута @wahrier (путь относительно страницы — работает и на GitHub Pages). */
export const SAMPLE_URL = './samples/wahrier-reconstruction.gpx';
export const SAMPLE_FILE_NAME = 'wahrier-reconstruction.gpx';
export const SAMPLE_AUTHOR = '@wahrier · реконструкция маршрута';
export const RECONSTRUCTION_LABEL = 'Реконструкция маршрута';
export const RECONSTRUCTION_NOTE = 'Реконструкция маршрута по афише (не GPS-запись).';

export const WAYPOINT_BADGE_LABEL = 'По меткам Organic Maps, не GPS-трек';

export const IMPORT_FAILED_MESSAGE = 'Не удалось обработать файл. Проверьте, что это GPX, KML, KMZ, GeoJSON или CSV с маршрутом, или попробуйте другой файл.';
export const SAMPLE_FAILED_MESSAGE = 'Не удалось загрузить пример. Проверьте подключение и повторите.';

let importToken = 0;

/** Дать браузеру отрисовать «Читаю файл…» до тяжёлого разбора. */
// (без requestAnimationFrame: в скрытой вкладке он не срабатывает и импорт бы зависал)
const nextPaint = () => new Promise<void>((r) => setTimeout(r, 30));

async function runImport(
  store: Store, fileNames: string[], parse: () => Promise<ParseResult>, reconstruction = false,
): Promise<void> {
  const token = ++importToken;
  const label = fileNames.length > 1 ? `Читаю ${fileNames.length} ${plural(fileNames.length, ['файл', 'файла', 'файлов'])}…` : 'Читаю файл…';
  store.set({ status: { phase: 'loading', message: label } });
  await nextPaint();
  try {
    const parsed = await parse();
    if (token !== importToken) return;
    if (!parsed.ok) {
      store.set({ status: { phase: 'error', message: parsed.error } });
      return;
    }
    if (requiresWaypointSelection(parsed.tracks)) {
      store.set({ route: null, enrichment: null, status: { phase: 'idle' }, source: {
        files: fileNames, warnings: parsed.warnings,
        waypointArchive: { tracks: parsed.tracks, chapters: parsed.chapters },
      } });
      return;
    }
    const importChoice = parsed.tracks.length ? createImportChoice(parsed.tracks) : null;
    const built = importChoice ? importChoice[importChoice.selected] : parsed.tracks.length ? buildRoute(parsed.tracks) : store.get().route;
    if (!built) { store.set({ status: { phase: 'error', message: 'Загрузите маршрут вместе с файлом глав.' } }); return; }
    const route = 'error' in built ? built : { ...built };
    if (!('error' in route)) {
      delete route.chapters;
      if (parsed.chapters?.length) route.chapters = parsed.chapters;
    }
    if (token !== importToken) return;
    if ('error' in route) {
      store.set({ status: { phase: 'error', message: route.error } });
      return;
    }
    const previousSource = !parsed.tracks.length ? store.get().source : null;
    const source: RouteSource = previousSource
      ? { ...previousSource, files: [...new Set([...previousSource.files, ...fileNames])], warnings: [...previousSource.warnings, ...parsed.warnings] }
      : { files: fileNames, warnings: parsed.warnings };
    if (reconstruction) source.reconstruction = true;
    if (importChoice) source.importChoice = importChoice;
    // Даже короткий архив хранится целиком: исключённые цвета можно вернуть через выбор участка.
    if (parsed.tracks.some(track => track.kmlImport?.organic)) {
      source.waypointArchive = { tracks: parsed.tracks, chapters: parsed.chapters };
      source.waypointSelection = {}; // короткий однозначный файл сохраняет автоматический сценарий
    }
    store.set({
      route,
      enrichment: null, // обогащение (страны, города, биты) достраивает модуль гео
      status: { phase: 'ready' },
      source,
    });
  } catch (err) {
    // неожиданный сбой разбора: показываем понятный текст и гасим «Читаю файл…»; прошлый маршрут остаётся
    console.error('Сбой при чтении маршрута:', err);
    if (token === importToken) store.set({ status: { phase: 'error', message: IMPORT_FAILED_MESSAGE } });
  }
}

/** Загрузить маршрут из выбранных файлов. При ошибке прошлый маршрут остаётся. */
export function importFiles(store: Store, files: File[]): Promise<void> {
  return runImport(store, files.map((f) => f.name), () => parseRouteFiles(files));
}

/** Загрузить маршрут из готового текста (например, встроенного примера). */
export function importText(store: Store, fileName: string, text: string, opts: { reconstruction?: boolean } = {}): Promise<void> {
  return runImport(store, [fileName], async () => parseRouteText(fileName, text), opts.reconstruction === true);
}

/** Подтверждение производного участка; исходный архив сохраняется для повторного выбора без чтения файла. */
export function confirmWaypointSelection(store: Store, selection: WaypointSelection): void {
  const state = store.get(), archive = state.source?.waypointArchive;
  if (!archive || state.status.phase === 'loading') return;
  const route = buildWaypointRoute(archive.tracks, selection);
  if ('error' in route) { store.set({ status: { phase: 'error', message: route.error } }); return; }
  if (archive.chapters?.length) route.chapters = archive.chapters;
  store.set({ route, enrichment: null, status: { phase: 'ready' },
    settings: { ...state.settings, info: importDefaults(route, false, state.settings.info), title: importTitle(route, state.settings.title),
      author: SAMPLE_AUTHORS.has(state.settings.author) ? '' : state.settings.author },
    source: { ...state.source!, waypointSelection: { ...selection, collections: selection.collections?.slice() } },
  });
}

export function confirmWaypointOrder(store: Store, confirmed: boolean): void {
  const state = store.get();
  if (!state.route || !isWaypoints(state.route)) return;
  const selection = state.source?.waypointSelection;
  const nextSelection = selection ? { ...selection, waypointOrderConfirmed: confirmed } : undefined;
  if (nextSelection && state.source?.waypointArchive) selectionDrafts.set(state.source.waypointArchive, nextSelection);
  store.set({ route: { ...state.route, waypointOrderConfirmed: confirmed },
    ...(nextSelection ? { source: { ...state.source!, waypointSelection: nextSelection } } : {}) });
}

function orderCheckbox(lang: AppState['settings']['lang'], checked: boolean, change: (checked: boolean) => void): HTMLLabelElement {
  const input = h('input', { type: 'checkbox', checked, 'data-testid': 'waypoint-order-confirmed' });
  input.addEventListener('change', () => change(input.checked));
  return h('label', {}, input, t(lang, 'import.orderConfirmed'));
}

/**
 * Значения по умолчанию для только что загруженного маршрута (история 80). Применяются, когда загрузили первый
 * маршрут или сменился род источника (пример ↔ файл пользователя), чтобы не затирать выбор при замене файла.
 * Реконструкция: день/дата/скорость/высота выключены; свой файл: высота включена, если она есть.
 */
export function importDefaults(route: Route, reconstruction: boolean, info: AppState['settings']['info']): AppState['settings']['info'] {
  // У меток только места ночёвок и число меток; слот day больше не показывает календарные дни.
  if (isWaypoints(route)) return { ...info, distance: false, progress: true, city: true, day: true, date: false, speed: false, altitude: false, profile: false };
  if (reconstruction) return { ...info, day: false, date: false, speed: false, altitude: false };
  return { ...info, altitude: route.hasEle };
}

const isWaypoints = (route: Route): boolean => route.source?.kind === 'waypoints';

/**
 * Заголовок по умолчанию после импорта. У маршрута по меткам имя KML-документа («Organic Maps Bookmarks and Tracks») —
 * не название поездки: оно не попадает в заголовок, поле остаётся пустым и ролик возьмёт страну. Свой текст не трогаем.
 */
export function importTitle(route: Route, current: string): string {
  if (!isWaypoints(route)) return current;
  const own = current.trim();
  return !own || own === (route.name ?? '').trim() ? '' : current;
}

type RouteKind = 'reconstruction' | 'waypoints' | 'track';
const kindOf = (route: Route, source: RouteSource | null): RouteKind =>
  source?.reconstruction ? 'reconstruction' : isWaypoints(route) ? 'waypoints' : 'track';
const SAMPLE_AUTHORS = new Set([SAMPLE_AUTHOR, WAYPOINT_SAMPLE_AUTHOR]);

/**
 * После успешного импорта: подпись автора у примера, заголовок и значения по умолчанию.
 * `sampleAuthor` — подпись встроенного примера; null — файл пользователя (подпись примера снимается).
 */
async function importAndFixAuthor(store: Store, sampleAuthor: string | null, run: () => Promise<void>): Promise<void> {
  const before = store.get();
  await run();
  const state = store.get();
  if (state.route === before.route || state.status.phase !== 'ready' || !state.route) return; // импорт не удался — всё как было
  const { author, title } = state.settings;
  const patch: Partial<AppState['settings']> = {};
  if (sampleAuthor) {
    if ((!author.trim() || SAMPLE_AUTHORS.has(author)) && author !== sampleAuthor) patch.author = sampleAuthor;
  } else if (SAMPLE_AUTHORS.has(author)) patch.author = '';
  const nextTitle = importTitle(state.route, title);
  if (nextTitle !== title) patch.title = nextTitle;
  const kind = kindOf(state.route, state.source);
  const prevKind = before.route && before.source ? kindOf(before.route, before.source) : null;
  if (prevKind === null || prevKind !== kind) {
    // Километраж у меток выключен из-за вида данных; при возврате к треку он снова доступен.
    const info = prevKind === 'waypoints' ? { ...state.settings.info, distance: true, city: DEFAULT_SETTINGS.info.city } : state.settings.info;
    patch.info = importDefaults(state.route, kind === 'reconstruction', info);
  }
  if (Object.keys(patch).length) store.updateSettings(patch);
}

/** Выбрать уже разобранный вариант, без повторного чтения файла; главы сохраняются. */
export async function selectImportKind(store: Store, kind: ImportKind): Promise<void> {
  await importAndFixAuthor(store, null, async () => {
    const state = store.get(), choice = state.source?.importChoice;
    if (!choice || choice.selected === kind || state.status.phase !== 'ready') return;
    const route = { ...choice[kind] };
    if (state.route?.chapters) route.chapters = state.route.chapters;
    store.set({ route, enrichment: null, source: { ...state.source!, importChoice: { ...choice, selected: kind } } });
  });
}

/** Кнопка «Пример»: грузит встроенный GPX из public/samples. */
export async function loadSample(store: Store): Promise<void> {
  await importAndFixAuthor(store, SAMPLE_AUTHOR, async () => {
    store.set({ status: { phase: 'loading', message: 'Загружаю пример…' } });
    let text: string;
    try {
      const res = await fetch(SAMPLE_URL);
      if (!res.ok) throw new Error(String(res.status));
      text = await res.text();
    } catch {
      store.set({ status: { phase: 'error', message: SAMPLE_FAILED_MESSAGE } });
      return;
    }
    await importText(store, SAMPLE_FILE_NAME, text, { reconstruction: true });
  });
}

/**
 * Кнопка второго примера (только dev): участок по меткам из private/. В сборке файла нет, поэтому и кнопки нет.
 * Источник — огрублённая выборка scripts/waypoints-sample.mjs; метки, не GPS-трек.
 */
export async function loadWaypointSample(store: Store, opts: { chapters?: boolean } = {}): Promise<void> {
  await importAndFixAuthor(store, WAYPOINT_SAMPLE_AUTHOR, async () => {
    store.set({ status: { phase: 'loading', message: 'Загружаю участок по меткам…' } });
    let text: string;
    try {
      const res = await fetch(WAYPOINT_SAMPLE_URL);
      if (!res.ok) throw new Error(String(res.status));
      text = await res.text();
      if (text.trimStart().startsWith('<')) throw new Error('html'); // dev-сервер отдал страницу вместо файла
    } catch {
      store.set({ status: { phase: 'error', message: WAYPOINT_SAMPLE_FAILED_MESSAGE } });
      return;
    }
    if (opts.chapters && import.meta.env.DEV) {
      let chapters: string | undefined;
      try {
        const response = await fetch('./private/wahrier/chapters.json');
        if (response.ok) {
          const body = await response.text();
          // Vite при отсутствии файла может вернуть HTML страницы с HTTP 200.
          if (!body.trimStart().startsWith('<')) chapters = body;
        }
      } catch { /* необязательный файл: маршрут остаётся доступен */ }
      if (chapters === undefined) await importText(store, WAYPOINT_SAMPLE_FILE_NAME, text);
      else await importFiles(store, [new File([text], WAYPOINT_SAMPLE_FILE_NAME), new File([chapters], 'chapters.json')]);
    } else await importText(store, WAYPOINT_SAMPLE_FILE_NAME, text);
  });
}

/**
 * Сводка одной строкой: «6 601 км · 70 дней · 4 676 точек». Дни — только если в файле есть время.
 * У реконструкции (пример) дни расчётные, а не записанные: «70 дней · расчётно».
 * У меток нет километража и дней поездки: «33 метки · 29 мест ночёвки».
 */
export function summaryLine(route: Route, reconstruction: boolean): string {
  const facts = isWaypoints(route) ? journeyFacts(route) : null;
  if (facts) {
    const marks = route.points.length;
    const parts = [`${formatInt(marks)} ${t('ru', 'summary.marks', { n: marks })}`,
      `${formatInt(facts.nightsTotal)} ${t('ru', 'summary.overnightPlaces', { n: facts.nightsTotal })}`];
    return parts.join(' · ');
  }
  const parts = [formatKm(route.totalM)];
  if (route.hasTime && route.days !== undefined) {
    parts.push(`${formatInt(route.days)} ${plural(route.days, ['день', 'дня', 'дней'])}`);
    if (reconstruction) parts.push('расчётно');
  }
  parts.push(`${formatInt(route.points.length)} ${plural(route.points.length, ['точка', 'точки', 'точек'])}`);
  return parts.join(' · ');
}

/** Заголовок сводки: у меток имя KML-документа («Organic Maps Bookmarks and Tracks») ничего не говорит о поездке. */
export function summaryTitle(route: Route, files: string[]): string {
  return isWaypoints(route) ? 'Маршрут по меткам' : route.name ?? files[0] ?? 'Маршрут';
}

/** Пояснения под сводкой. У маршрута по меткам нет времени и высоты не из-за файла, а по природе меток — говорим как есть. */
export function routeHints(route: Route): string[] {
  if (isWaypoints(route)) {
    return [t('ru', 'import.waypointHint')];
  }
  const hints: string[] = [];
  if (!route.hasTime) hints.push('В файле нет времени — дата, день и скорость в ролике будут недоступны, прогресс пойдёт по расстоянию.');
  if (!route.hasEle) hints.push('В файле нет высоты — высота и профиль в ролике будут недоступны.');
  return hints;
}

function renderSummary(route: Route, state: AppState, pickFiles: () => void, store: Store): HTMLElement {
  const files = state.source?.files ?? [];
  const title = summaryTitle(route, files);
  const hints = routeHints(route);
  const warnings = state.source?.warnings ?? [];
  const chapters = state.enrichment ? new Set(matchChapters(route, state.enrichment).filter((m) => !m.chapter.finale).map((m) => m.chapter.id)).size : 0;

  const replace = h('button', { type: 'button', class: 'button button--ghost', 'data-testid': 'replace-file', text: 'Заменить файл' });
  replace.addEventListener('click', pickFiles);

  const choice = state.source?.importChoice;
  const switcher = choice ? h('div', { class: 'summary__actions', role: 'group', 'aria-label': 'Источник маршрута', 'data-testid': 'import-choice' },
    ...(['track', 'waypoints'] as const).map((kind) => {
      const active = choice.selected === kind;
      const button = h('button', { type: 'button', class: active ? 'button button--primary' : 'button button--ghost',
        text: kind === 'track' ? 'Трек' : 'Метки путешествия', 'aria-pressed': String(active),
        'data-testid': `import-${kind}`, disabled: state.status.phase !== 'ready' });
      button.addEventListener('click', () => { void selectImportKind(store, kind); });
      return button;
    }),
  ) : null;

  return h('div', { class: 'summary', 'data-testid': 'route-summary' },
    h('div', { class: 'summary__head' },
      icon('file', 'icon summary__icon'),
      h('div', { class: 'summary__text' },
        h('div', { class: 'summary__title', title, text: title }),
        h('div', { class: 'summary__line', 'data-testid': 'route-summary-line', text: summaryLine(route, state.source?.reconstruction === true) }),
        files.length ? h('div', { class: 'summary__files', text: files.join(', ') }) : null,
      ),
    ),
    switcher,
    isWaypoints(route) ? orderCheckbox(state.settings.lang, route.waypointOrderConfirmed === true, value => confirmWaypointOrder(store, value)) : null,
    route.importReport ? h('p', { class: 'summary__hint', 'data-testid': 'waypoint-composition', text: t(state.settings.lang, 'import.composition', { n: route.points.length, total: route.importReport.unique, duplicates: route.importReport.duplicates }) }) : null,
    route.importReport?.excludedOtherColors ? h('p', { class: 'summary__hint', 'data-testid': 'waypoint-other-colors-count',
      text: t(state.settings.lang, 'import.otherColors', { n: route.importReport.excludedOtherColors }) }) : null,
    isWaypoints(route) && state.source?.waypointArchive ? (() => {
      const edit = h('button', { type: 'button', class: 'button button--ghost', 'data-testid': 'waypoint-reselect', text: t(state.settings.lang, 'import.chooseSegment') });
      edit.addEventListener('click', () => store.set({ route: null, enrichment: null, status: { phase: 'idle' }, source: { ...store.get().source!, waypointSelection: undefined } }));
      return edit;
    })() : null,
    chapters ? h('p', { class: 'summary__hint', 'data-testid': 'chapters-badge', text: `Главы: ${chapters} · ${sourceLabel('ru', 'traveler')}` }) : null,
    ...[...hints, ...warnings].map((text) => h('p', { class: 'summary__hint', text })),
    h('div', { class: 'summary__actions' },
      replace,
      state.source?.reconstruction
        ? h('div', { class: 'badge', 'data-testid': 'reconstruction-badge' }, icon('info', 'icon'), h('span', { text: RECONSTRUCTION_LABEL }))
        : null,
      isWaypoints(route)
        ? h('div', { class: 'badge', 'data-testid': 'waypoints-badge' }, icon('info', 'icon'), h('span', { text: WAYPOINT_BADGE_LABEL }))
        : null,
    ),
    routeFactsView(state),
  );
}

const selectionDrafts = new WeakMap<WaypointArchive, WaypointSelection>();
function renderWaypointSelection(state: AppState, store: Store, pickFiles: () => void): HTMLElement {
  const archive = state.source!.waypointArchive!, lang = state.settings.lang;
  const { all, report } = summarizeKmlImport(archive.tracks);
  const dates = all.flatMap(p => p.markedAt === undefined ? [] : [p.markedAt]);
  const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const draft = selectionDrafts.get(archive);
  let orderConfirmed = draft?.waypointOrderConfirmed === true;
  const order = orderCheckbox(lang, orderConfirmed, value => { orderConfirmed = value; update(); });
  const from = h('input', { type: 'date', 'data-testid': 'waypoint-from', 'aria-label': t(lang, 'import.from'), value: draft ? (draft.from === undefined ? undefined : isoDate(draft.from)) : dates.length ? isoDate(Math.min(...dates)) : undefined });
  const to = h('input', { type: 'date', 'data-testid': 'waypoint-to', 'aria-label': t(lang, 'import.to'), value: draft ? (draft.to === undefined ? undefined : isoDate(draft.to)) : dates.length ? isoDate(Math.max(...dates)) : undefined });
  const boxes = report.collections.filter(c => c.unique > 0).map((c, i) => {
    const input = h('input', { type: 'checkbox', checked: draft?.collections ? draft.collections.includes(waypointCollectionKey(c)) : true, value: waypointCollectionKey(c), 'data-testid': `waypoint-collection-${i}` });
    return { input, label: h('label', {}, input, `${c.collection} · ${c.unique}`) };
  });
  const undated = h('input', { type: 'checkbox', checked: draft?.includeUndated !== false, 'data-testid': 'waypoint-undated' });
  const undatedCount = all.filter(p => p.markedAt === undefined).length;
  const otherColors = h('input', { type: 'checkbox', checked: draft?.includeOtherColors === true, 'data-testid': 'waypoint-other-colors' });
  const otherColorsReport = h('p', { 'data-testid': 'waypoint-other-colors-count', 'aria-live': 'polite' });
  const result = h('p', { 'data-testid': 'waypoint-selection-count', 'aria-live': 'polite' });
  const confirm = h('button', { type: 'button', class: 'button button--primary', 'data-testid': 'waypoint-confirm' });
  const selection = (): WaypointSelection => ({
    from: from.value ? Date.parse(`${from.value}T00:00:00Z`) : undefined,
    to: to.value ? Date.parse(`${to.value}T23:59:59.999Z`) : undefined,
    collections: boxes.filter(b => b.input.checked).map(b => b.input.value), includeUndated: undated.checked, includeOtherColors: otherColors.checked,
    waypointOrderConfirmed: orderConfirmed,
  });
  const update = () => {
    const s = selection(), summary = summarizeKmlImport(archive.tracks, s), selected = summary.selected;
    otherColorsReport.textContent = t(lang, 'import.otherColors', { n: summary.report.excludedOtherColors ?? 0 });
    selectionDrafts.set(archive, s);
    const nights = new Set(selected.filter(p => p.kind === 'overnight').map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`)).size;
    const valid = from.validity.valid && to.validity.valid && !(s.from !== undefined && s.to !== undefined && s.from > s.to);
    confirm.disabled = !valid || selected.length < 2;
    confirm.textContent = t(lang, 'import.confirm', { n: selected.length, nights });
    result.textContent = t(lang, valid ? 'import.composition' : 'import.invalidPeriod', { n: selected.length, total: all.length, duplicates: report.duplicates });
  };
  for (const input of [from, to, undated, otherColors, ...boxes.map(b => b.input)]) input.addEventListener('change', update);
  confirm.addEventListener('click', () => { if (!confirm.disabled) confirmWaypointSelection(store, selection()); });
  const replace = h('button', { type: 'button', class: 'button button--ghost', text: t(lang, 'import.replace') });
  replace.addEventListener('click', pickFiles);
  update();
  return h('div', { class: 'summary waypoint-selection', 'data-testid': 'waypoint-selection' },
    h('h3', { text: t(lang, 'import.chooseSegment') }),
    h('p', { text: t(lang, 'import.bookmarkTimes') }),
    h('p', { text: t(lang, 'import.dateSpan', { from: dates.length ? isoDate(Math.min(...dates)) : '—', to: dates.length ? isoDate(Math.max(...dates)) : '—' }) }),
    h('div', { class: 'waypoint-selection__period' }, h('label', {}, t(lang, 'import.from'), from), h('label', {}, t(lang, 'import.to'), to)),
    h('fieldset', { class: 'waypoint-selection__collections' }, h('legend', { text: t(lang, 'import.collections') }), ...boxes.map(b => b.label)),
    undatedCount ? h('label', {}, undated, t(lang, 'import.undated', { n: undatedCount })) : null,
    otherColorsReport, h('label', {}, otherColors, t(lang, 'import.includeOtherColors')), order, result, confirm, replace,
  );
}

export function createRouteStep(store: Store, opts: { waypointSample?: boolean } = {}): HTMLElement {
  const input = h('input', {
    type: 'file', multiple: true, accept: ACCEPT, class: 'visually-hidden',
    id: 'route-file-input', 'data-testid': 'file-input', tabindex: -1, 'aria-label': 'Файлы маршрута',
  });
  const pickFiles = () => input.click();
  input.addEventListener('change', () => {
    const files = Array.from(input.files ?? []);
    input.value = ''; // чтобы тот же файл можно было выбрать снова
    if (files.length) void importAndFixAuthor(store, null, () => importFiles(store, files));
  });

  const status = h('div', { class: 'section__status', 'aria-live': 'polite', 'data-testid': 'route-status' });
  const box = h('div', { class: 'route-box' });
  const notices = h('div', { class: 'route-notices' });

  const choose = (primary: boolean) => {
    const b = h('button', { type: 'button', class: primary ? 'button button--primary' : 'button button--ghost', text: 'Выбрать файлы' });
    b.addEventListener('click', pickFiles);
    return b;
  };

  const renderEmpty = () => h('div', { class: 'dropzone' },
    icon('upload', 'icon dropzone__icon'),
    h('div', { class: 'dropzone__title', text: 'Перетащите трек сюда' }),
    h('p', { class: 'dropzone__text', text: 'GPX · GeoJSON · CSV · KML · KMZ. Можно несколько файлов.' }),
    choose(true),
  );

  const render = (state: AppState) => {
    const st = state.status;
    status.replaceChildren(
      ...(st.phase === 'loading' ? [h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: st.message })] : []),
    );
    notices.replaceChildren();
    if (st.phase === 'error') {
      const retry = st.message === SAMPLE_FAILED_MESSAGE;
      const act = h('button', { type: 'button', class: 'button button--ghost', text: retry ? 'Повторить' : 'Выбрать другой файл' });
      act.addEventListener('click', () => { if (retry) void loadSample(store); else pickFiles(); });
      notices.append(h('div', { class: 'notice notice--error', role: 'alert', 'data-testid': 'route-error' },
        icon('alert', 'icon notice__icon'),
        h('div', { class: 'notice__body' },
          h('div', { text: st.message }),
          state.route ? h('div', { class: 'notice__sub', text: 'Предыдущий маршрут остался загруженным.' }) : null,
          act,
        ),
      ));
    }
    box.replaceChildren(state.source?.waypointArchive && !state.source.waypointSelection
      ? renderWaypointSelection(state, store, pickFiles)
      : state.route ? renderSummary(state.route, state, pickFiles, store) : renderEmpty());
  };
  store.subscribe((s, prev) => {
    if (s.route !== prev.route || s.status !== prev.status || s.source !== prev.source || s.enrichment !== prev.enrichment || s.settings.lang !== prev.settings.lang) render(s);
  });
  render(store.get());

  // перетаскивание — на всю секцию: и в пустом состоянии, и поверх сводки («заменить файл»)
  const section = createSection({ id: 'step-route', title: 'Маршрут', testid: 'section-route' }, h('div', { class: 'route-body' }, input, box, notices), status);
  for (const ev of ['dragenter', 'dragover'] as const) {
    section.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('is-drag'); });
  }
  section.addEventListener('dragleave', (e) => {
    if (!section.contains(e.relatedTarget as Node | null)) box.classList.remove('is-drag');
  });
  section.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('is-drag');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length) void importAndFixAuthor(store, null, () => importFiles(store, files));
  });

  const sampleBtn = h('button', { type: 'button', class: 'button button--ghost', 'data-testid': 'load-sample', text: 'Пример: маршрут @wahrier' });
  sampleBtn.addEventListener('click', () => { void loadSample(store); });
  const sampleNote = h('p', { class: 'sample__note', text: RECONSTRUCTION_NOTE });
  // пустое состояние: пример — заметная кнопка с пометкой; после загрузки — тихая ссылка (основное действие уже в сцене)
  const syncSample = (s: AppState) => {
    sampleBtn.className = s.route ? 'button button--text' : 'button button--ghost';
    sampleNote.hidden = s.route !== null;
  };
  store.subscribe(syncSample);
  syncSample(store.get());
  section.append(h('div', { class: 'sample' }, sampleBtn, sampleNote));

  // второй пример — только в dev (файл лежит в private/, вне git); в собранном сайте кнопки нет совсем
  if (import.meta.env.DEV && opts.waypointSample !== false) { // условие на import.meta.env.DEV — чтобы сборка выбросила кнопку целиком
    const marksBtn = h('button', { type: 'button', class: 'button button--ghost', 'data-testid': 'load-sample-waypoints', text: WAYPOINT_SAMPLE_LABEL });
    marksBtn.addEventListener('click', () => { void loadWaypointSample(store, { chapters: true }); });
    const marksNote = h('p', { class: 'sample__note', 'data-testid': 'waypoints-sample-note', text: WAYPOINT_SAMPLE_NOTE });
    const syncMarks = (s: AppState) => {
      marksBtn.className = s.route ? 'button button--text' : 'button button--ghost';
      marksNote.hidden = s.route !== null;
    };
    store.subscribe(syncMarks);
    syncMarks(store.get());
    section.append(h('div', { class: 'sample' }, marksBtn, marksNote));
  }
  return section;
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import waypointSample from '../fixtures/synthetic/waypoint-sample.json?raw';
import trackGpx from '../fixtures/track.gpx?raw';
import sampleText from '../../public/samples/wahrier-reconstruction.gpx?raw';
import { buildRoute, parseRouteText } from '../../src/route';
import type { Route } from '../../src/types';
import { createStore, DEFAULT_SETTINGS } from '../../src/ui/state';
import { infoHint } from '../../src/ui/studio/controls';
import {
  importDefaults, importFiles, importTitle, loadSample, loadWaypointSample, routeHints, SAMPLE_AUTHOR, summaryLine, summaryTitle,
} from '../../src/ui/step-route';
import { WAYPOINT_SAMPLE_AUTHOR, WAYPOINT_SAMPLE_NOTE, WAYPOINT_SAMPLE_URL, waypointInfoLabel } from '../../src/ui/waypoint-sample';

function routeOf(name: string, text: string): Route {
  const parsed = parseRouteText(name, text);
  if (!parsed.ok) throw new Error(parsed.error);
  const r = buildRoute(parsed.tracks);
  if ('error' in r) throw new Error(r.error);
  return r;
}

const flat = (s: string) => s.replace(/\s/g, ' ');
afterEach(() => { vi.unstubAllGlobals(); });

describe('маршрут по меткам в сводке страницы', () => {
  const route = () => routeOf('waypoint-sample.json', waypointSample);

  it('строка сводки: метки и места ночёвок — без дней поездки и километража', () => {
    const line = flat(summaryLine(route(), false));
    expect(line).toBe('6 меток · 5 мест ночёвок');
    expect(line).not.toMatch(/км|точ/);
  });

  it('прежние сводки не изменились (трек и реконструкция)', () => {
    const wahrier = routeOf('wahrier-reconstruction.gpx', sampleText);
    expect(flat(summaryLine(wahrier, true))).toBe('6 601 км · 70 дней · расчётно · 4 676 точек');
    expect(flat(summaryLine(routeOf('track.gpx', trackGpx), false))).toMatch(/ км/);
  });

  it('заголовок сводки и подсказки не говорят про GPS: нет времени/высоты — это не недостаток файла', () => {
    expect(summaryTitle(route(), ['waypoint-sample.json'])).toBe('Маршрут по меткам');
    const hints = routeHints(route()).join(' ');
    expect(hints).toMatch(/не GPS-трек/);
    expect(hints).not.toMatch(/нет времени|нет высоты/);
    expect(routeHints(routeOf('wahrier-reconstruction.gpx', sampleText))).toEqual([]);
  });

  it('подписи показателей — как в ролике: «Ночёвки», «День по меткам»', () => {
    const r = route();
    expect(waypointInfoLabel('progress', 'Прогресс', r)).toBe('Места ночёвок');
    expect(waypointInfoLabel('day', 'День путешествия', r)).toBe('Метки');
    expect(waypointInfoLabel('country', 'Страна и флаг', r)).toBe('Страна и флаг');
    expect(waypointInfoLabel('progress', 'Прогресс', routeOf('track.gpx', trackGpx))).toBe('Прогресс');
    expect(waypointInfoLabel('progress', 'Прогресс', null)).toBe('Прогресс');
  });

  it('ночёвки и день по меткам доступны без GPS-времени; GPS-показатели недоступны с причиной', () => {
    const state = createStore({ route: route() }).get();
    expect(infoHint({ key: 'progress', label: 'Прогресс' }, state)).toEqual({ text: '', disabled: false });
    expect(infoHint({ key: 'day', label: 'День путешествия', needs: 'time' }, state)).toEqual({ text: '', disabled: false });
    for (const key of ['distance', 'speed', 'date', 'altitude', 'profile'] as const) {
      expect(infoHint({ key, label: key }, state)).toEqual({ text: 'нет GPS-трека', disabled: true });
    }
    const noDates = { ...route(), journeyWaypoints: route().journeyWaypoints!.map((p) => ({ ...p, markedAt: undefined })) };
    expect(infoHint({ key: 'day', label: 'День', needs: 'time' }, createStore({ route: noDates }).get()))
      .toEqual({ text: 'у меток нет времени', disabled: true });
  });
});

describe('значения по умолчанию для маршрута по меткам', () => {
  it('километр, скорость, высота, профиль, дата выключены; ночёвки, день и страна включены', () => {
    const route = routeOf('waypoint-sample.json', waypointSample);
    const info = importDefaults(route, false, { ...DEFAULT_SETTINGS.info, speed: true, altitude: true });
    expect(info).toMatchObject({ distance: false, speed: false, altitude: false, profile: false, date: false, progress: true, day: true, country: true });
  });

  it('заголовок: имя KML-документа не становится названием поездки; свой текст сохраняется', () => {
    const route = routeOf('waypoint-sample.json', waypointSample);
    const doc = 'Organic Maps Bookmarks and Tracks';
    expect(importTitle({ ...route, name: doc }, doc)).toBe('');
    expect(importTitle({ ...route, name: doc }, '')).toBe('');
    expect(importTitle({ ...route, name: doc }, 'Мой участок')).toBe('Мой участок');
    const track = routeOf('track.gpx', trackGpx);
    expect(importTitle({ ...track, name: 'Хребет' }, 'Хребет')).toBe('Хребет');
  });
});

describe('второй пример: участок по меткам', () => {
  const stubFetch = (body: string, status = 200) => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => { calls.push(String(url)); return new Response(body, { status }); });
    return calls;
  };

  it('грузит выборку из private/ (только dev), без реконструкции и с подписью @wahrier', async () => {
    const calls = stubFetch(waypointSample);
    const store = createStore();
    store.updateSettings({ info: { ...DEFAULT_SETTINGS.info, distance: true, altitude: true } });
    await loadWaypointSample(store);
    const s = store.get();
    expect(calls).toEqual([WAYPOINT_SAMPLE_URL]);
    expect(WAYPOINT_SAMPLE_URL).toMatch(/^\.\/private\//);
    expect(s.status.phase).toBe('ready');
    expect(s.route?.source?.kind).toBe('waypoints');
    expect(s.source?.reconstruction).toBeUndefined();
    expect(s.settings.author).toBe(WAYPOINT_SAMPLE_AUTHOR);
    expect(s.settings.title).toBe('');
    expect(s.settings.info).toMatchObject({ distance: false, altitude: false, progress: true, day: true });
    expect(WAYPOINT_SAMPLE_NOTE).toBe('по меткам Organic Maps, не GPS-трек');
  });

  it('нет файла (не dev-машина автора) — понятная ошибка, прежний маршрут остаётся', async () => {
    stubFetch('', 404);
    const store = createStore();
    await loadWaypointSample(store);
    expect(store.get().status).toMatchObject({ phase: 'error' });
    expect(store.get().route).toBeNull();
  });

  it('прежний пример-реконструкция не затронут: подпись, помета, значения по умолчанию', async () => {
    vi.stubGlobal('fetch', async () => new Response(sampleText, { status: 200 }));
    const store = createStore();
    await loadSample(store);
    const s = store.get();
    expect(s.source?.reconstruction).toBe(true);
    expect(s.settings.author).toBe(SAMPLE_AUTHOR);
    expect(s.settings.info).toMatchObject({ day: false, date: false, speed: false, altitude: false, distance: true, progress: true });
  });

  it('переключение между примерами и своим файлом меняет подпись и показатели', async () => {
    const store = createStore();
    vi.stubGlobal('fetch', async () => new Response(sampleText, { status: 200 }));
    await loadSample(store);
    vi.stubGlobal('fetch', async () => new Response(waypointSample, { status: 200 }));
    await loadWaypointSample(store);
    expect(store.get().settings.author).toBe(WAYPOINT_SAMPLE_AUTHOR);
    expect(store.get().settings.info).toMatchObject({ distance: false, day: true });
    await importFiles(store, [new File([trackGpx], 'track.gpx')]);
    // importFiles сам подпись не трогает (это делает обработчик выбора файла); маршрут сменился на трек
    expect(store.get().route?.source?.kind).not.toBe('waypoints');
  });

  it('возврат от меток к прежнему примеру восстанавливает километраж реконструкции', async () => {
    const store = createStore();
    stubFetch(waypointSample);
    await loadWaypointSample(store);
    stubFetch(sampleText);
    await loadSample(store);
    expect(store.get().settings.info).toMatchObject({ distance: true, progress: true, day: false });
    expect(store.get().settings.author).toBe(SAMPLE_AUTHOR);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import trackGpx from '../fixtures/track.gpx?raw';
import sampleText from '../../public/samples/wahrier-reconstruction.gpx?raw';
import { buildRoute, parseRouteText } from '../../src/route';
import type { Route } from '../../src/types';
import { createStore, DEFAULT_SETTINGS } from '../../src/ui/state';
import { importDefaults, importFiles, loadSample, SAMPLE_AUTHOR, summaryLine } from '../../src/ui/step-route';
import { ESTIMATED_HINT, infoHint, type InfoItem } from '../../src/ui/studio/controls';

const NO_TIME_CSV = 'lat,lon\n10,10\n10.1,10.1\n10.2,10.2\n';

function routeOf(name: string, text: string): Route {
  const parsed = parseRouteText(name, text);
  if (!parsed.ok) throw new Error(parsed.error);
  const r = buildRoute(parsed.tracks);
  if ('error' in r) throw new Error(r.error);
  return r;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('значения по умолчанию (история 80)', () => {
  it('по умолчанию включены «пройдено», «прогресс», «страна»; день/дата/скорость — нет', () => {
    const on = Object.entries(DEFAULT_SETTINGS.info).filter(([, v]) => v).map(([k]) => k).sort();
    expect(on).toEqual(['country', 'distance', 'progress']);
  });

  it('пример: помечен реконструкцией, подпись автора, день/дата/скорость/высота выключены', async () => {
    vi.stubGlobal('fetch', async () => new Response(sampleText, { status: 200 }));
    const store = createStore();
    store.updateSettings({ info: { ...DEFAULT_SETTINGS.info, day: true, speed: true, altitude: true } });
    await loadSample(store);
    const s = store.get();
    expect(s.status.phase).toBe('ready');
    expect(s.source?.reconstruction).toBe(true);
    expect(s.settings.author).toBe(SAMPLE_AUTHOR);
    expect(s.settings.info).toMatchObject({ day: false, date: false, speed: false, altitude: false, distance: true, progress: true, country: true });
  });

  it('свой файл не помечается реконструкцией, высота включается, если она есть', async () => {
    const store = createStore();
    await importFiles(store, [new File([trackGpx], 'track.gpx')]);
    const route = store.get().route!;
    expect(store.get().source?.reconstruction).toBeUndefined();
    expect(importDefaults(route, false, DEFAULT_SETTINGS.info).altitude).toBe(route.hasEle);
  });
});

describe('сводка и пометки', () => {
  it('сводка одной строкой: км · дни · точки', () => {
    const route = routeOf('wahrier-reconstruction.gpx', sampleText);
    expect(summaryLine(route, false).replace(/\s/g, ' ')).toBe('6 601 км · 70 дней · 4 676 точек');
  });

  it('пример-реконструкция: дни в сводке помечены «расчётно»', () => {
    const route = routeOf('wahrier-reconstruction.gpx', sampleText);
    expect(summaryLine(route, true).replace(/\s/g, ' ')).toBe('6 601 км · 70 дней · расчётно · 4 676 точек');
  });

  it('свой файл (reconstruction: false): сводка без пометки', () => {
    const route = routeOf('wahrier-reconstruction.gpx', sampleText);
    expect(summaryLine(route, false)).not.toMatch(/расчётно/);
    expect(summaryLine(route, false).replace(/\s/g, ' ')).toBe('6 601 км · 70 дней · 4 676 точек');
  });

  it('без времени в сводке нет дней и нет пометки', () => {
    expect(summaryLine(routeOf('x.csv', NO_TIME_CSV), false)).not.toMatch(/дн/);
    expect(summaryLine(routeOf('x.csv', NO_TIME_CSV), true)).not.toMatch(/дн|расчётно/);
  });

  it('у реконструкции день/дата/скорость подписаны «расчётно»; недоступное — причиной', () => {
    const sample = routeOf('wahrier-reconstruction.gpx', sampleText);
    const store = createStore({ route: sample, source: { files: ['a.gpx'], warnings: [], reconstruction: true } });
    const day: InfoItem = { key: 'day', label: 'День', needs: 'time', estimatedOnSample: true };
    expect(infoHint(day, store.get())).toEqual({ text: ESTIMATED_HINT, disabled: false });
    const noTime = routeOf('x.csv', NO_TIME_CSV);
    expect(infoHint(day, createStore({ route: noTime }).get())).toEqual({ text: 'в файле нет времени', disabled: true });
    expect(infoHint({ key: 'distance', label: 'Пройдено' }, store.get())).toEqual({ text: '', disabled: false });
  });
});

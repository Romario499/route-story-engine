import { describe, expect, it } from 'vitest';
import { ExportError, exportVideo, isExportRunning, TILE_SLOW_TIMEOUT_MS, TILE_TIMEOUT_MS, type ExportDeps, type ExportProgress } from '../../src/export';
import { timelineOptionsFor } from '../../src/render/layout';
import { isAbortError } from '../../src/export/util';
import { FontLoadError } from '../../src/render/fonts';
import type { Scene } from '../../src/render/scene';
import { FPS, type FrameState, type Route, type StorySettings } from '../../src/types';
import { enrichmentFor, lineRoute, settings } from '../story/fixtures';

interface Log {
  rendered: number[];            // t каждого вызова render
  waitForTiles: boolean[];
  timeouts: (number | undefined)[]; // timeoutMs каждого вызова render
  complete: boolean[];              // tilesComplete каждого вызова render
  encoded: { timestamp: number; duration: number; key: boolean }[];
  sceneDestroyed: number;
  encoderClosed: number;
  hostDisposed: number;
  frameClosed: number;
  frameOpen: number;
  maxOpenFrames: number;
  muxed: number;
  finished: number;
  scenesCreated: number;
  encodersCreated: number;
  sceneStyles: string[];                 // styleId, с которым создана сцена
  dataSettings: StorySettings[];         // что передано в scene.setData (по ссылке — видно, мутировали ли снаружи)
  dataRoutes: Route[];
  dataReconstruction: boolean[];         // флаг «реконструкция», с которым вызван scene.setData
  lose: (() => void) | null;             // имитация webglcontextlost
  unwatched: number;
}

interface Opts {
  failTiles?: (renderCall: number, frameIdx: number) => boolean;
  onRender?: (n: number) => void;
  /** Вернуть true — render зависает навсегда (как при потере контекста WebGL). */
  hangRender?: (n: number) => boolean;
}

const newLog = (): Log => ({
  rendered: [], waitForTiles: [], timeouts: [], complete: [], encoded: [], sceneDestroyed: 0, encoderClosed: 0, hostDisposed: 0, frameClosed: 0, frameOpen: 0, maxOpenFrames: 0, muxed: 0, finished: 0,
  scenesCreated: 0, encodersCreated: 0, sceneStyles: [], dataSettings: [], dataRoutes: [], dataReconstruction: [], lose: null, unwatched: 0,
});

type EncoderLike = ReturnType<ExportDeps['createEncoder']>;

function fakeEncoder(init: Parameters<ExportDeps['createEncoder']>[0], log: Log, queue: { size: () => number; onWait?: (fn: () => void) => void }): EncoderLike {
  return {
    get encodeQueueSize() { return queue.size(); },
    get state() { return 'configured' as const; },
    configure: () => {},
    encode(frame, opts) {
      const f = frame as unknown as { timestamp: number; duration: number };
      log.encoded.push({ timestamp: f.timestamp, duration: f.duration, key: Boolean(opts?.keyFrame) });
      queueMicrotask(() => init.output({ type: 'key' } as EncodedVideoChunk, undefined));
    },
    flush: async () => { await new Promise((r) => setTimeout(r, 0)); },
    close: () => { log.encoderClosed++; },
    addEventListener: ((_type: string, fn: () => void) => { queue.onWait?.(fn); }) as EncoderLike['addEventListener'],
    removeEventListener: () => {},
  };
}

function makeDeps(log: Log, o: Opts = {}): ExportDeps {
  let renderCalls = 0;
  const scene: Scene = {
    canvas: {} as HTMLCanvasElement,
    setStyle: async () => {},
    setData: (route, _enrichment, st, reconstruction) => { log.dataRoutes.push(route); log.dataSettings.push(st); log.dataReconstruction.push(reconstruction); },
    render: async (frame: FrameState, opts) => {
      const n = renderCalls++;
      log.rendered.push(frame.t);
      log.waitForTiles.push(opts.waitForTiles);
      log.timeouts.push(opts.timeoutMs);
      o.onRender?.(n);
      if (o.hangRender?.(n)) await new Promise<never>(() => {});
      await Promise.resolve();
      const frameIdx = Math.round(frame.t * FPS);
      const tilesComplete = !o.failTiles?.(n, frameIdx);
      log.complete.push(tilesComplete);
      return { tilesComplete };
    },
    destroy: () => { log.sceneDestroyed++; },
  };
  return {
    createHost: () => ({ host: {} as HTMLElement, dispose: () => { log.hostDisposed++; } }),
    createScene: async (_host, sceneOpts) => { log.scenesCreated++; log.sceneStyles.push(sceneOpts.styleId); return scene; },
    ensureFonts: async () => {},
    preloadAssets: async () => {},
    watchWebglLoss: (_scene, onLost) => { log.lose = onLost; return () => { log.unwatched++; }; },
    detect: async () => ({ supported: true, container: 'mp4', codec: 'avc1.640028' }),
    createEncoder: (init) => { log.encodersCreated++; return fakeEncoder(init, log, { size: () => 0 }); },
    createVideoFrame: (_canvas, init) => {
      log.frameOpen++; log.maxOpenFrames = Math.max(log.maxOpenFrames, log.frameOpen);
      return { timestamp: init.timestamp, duration: init.duration, close: () => { log.frameClosed++; log.frameOpen--; } } as unknown as VideoFrame;
    },
    createMuxer: () => ({
      addChunk: () => { log.muxed++; },
      finish: () => { log.finished++; return new Blob(['x'], { type: 'video/mp4' }); },
    }),
  };
}

/** Сколько раз render ждал полный TILE_TIMEOUT_MS и всё равно не дождался (каждое такое ожидание стоит ролику 10 с). */
const longWaitsThatTimedOut = (log: Log): number => log.timeouts.filter((t, i) => t === TILE_TIMEOUT_MS && !log.complete[i]).length;

function args(overrides: { reconstruction?: boolean; title?: string; signal?: AbortSignal; onProgress?: (p: ExportProgress) => void } = {}) {
  const route = lineRoute(200);
  return {
    route,
    enrichment: enrichmentFor(route),
    settings: settings({ durationSec: 15, title: overrides.title ?? 'Хива', format: '9:16' }),
    onProgress: overrides.onProgress ?? (() => {}),
    signal: overrides.signal ?? new AbortController().signal,
    timelineOptions: timelineOptionsFor('9:16', 'epic'),
    reconstruction: overrides.reconstruction ?? false,
  };
}

describe('exportVideo', () => {
  it('неготовый кадр никогда не подаётся энкодеру, исчерпание бюджета — явная ошибка', async () => {
    const log = newLog();
    await expect(exportVideo(args(), makeDeps(log, { failTiles: (_n, idx) => idx === 10 })))
      .rejects.toMatchObject({ kind: 'tiles' });
    expect(log.encoded).toHaveLength(10);
    expect(log.finished).toBe(0);
    expect(log.rendered).toHaveLength(13);
    expect(log.sceneDestroyed).toBe(1);
  });
  it('рендерит durationSec×30 кадров с ожиданием тайлов, метки времени по сетке 30 fps, ключевой кадр каждые 60', async () => {
    const log = newLog();
    const progress: number[] = [];
    const res = await exportVideo(args({ onProgress: (p) => progress.push(p.frame) }), makeDeps(log));
    expect(res.frames).toBe(450);
    expect(log.rendered).toHaveLength(450);
    expect(log.waitForTiles.every(Boolean)).toBe(true);
    expect(log.encoded).toHaveLength(450);
    expect(log.encoded[0]).toEqual({ timestamp: 0, duration: 33333, key: true });
    expect(log.encoded[30].timestamp).toBe(1_000_000);
    expect(log.encoded[449].timestamp).toBe(Math.round((449 * 1e6) / 30));
    const keys = log.encoded.flatMap((e, i) => (e.key ? [i] : []));
    expect(keys).toEqual([0, 60, 120, 180, 240, 300, 360, 420]);
    expect(log.rendered[1]).toBeCloseTo(1 / 30, 9);
    expect(progress[progress.length - 1]).toBe(450);
    expect(res.mimeType).toBe('video/mp4');
    expect(res.fileName).toBe('route-story_Хива_9x16.mp4');
    expect(res.tileWarnings).toBe(0);
  });

  it('первый кадр не рисуется, пока не загрузились ресурсы оформления (флаги)', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    const order: string[] = [];
    let release!: () => void;
    deps.preloadAssets = () => new Promise<void>((resolve) => { order.push('preload-start'); release = () => { order.push('preload-done'); resolve(); }; });
    const origScene = deps.createScene;
    deps.createScene = async (...a) => {
      const sc = await origScene(...a);
      const render = sc.render.bind(sc);
      sc.render = async (...r) => { order.push('render'); return render(...r); };
      return sc;
    };
    const done = exportVideo(args(), deps);
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['preload-start']);
    expect(log.rendered).toHaveLength(0);
    release();
    await done;
    expect(order.slice(0, 3)).toEqual(['preload-start', 'preload-done', 'render']);
  });

  it('без своего заголовка файл называется по умолчанию «<страна старта> → <страна финиша>», а не именем GPX', async () => {
    const res = await exportVideo(args({ title: '' }), makeDeps(newLog()));
    expect(res.fileName).toBe('route-story_Грузия-Армения_9x16.mp4');
  });

  it('каждый VideoFrame закрывается, ресурсы освобождены после успеха', async () => {
    const log = newLog();
    await exportVideo(args(), makeDeps(log));
    expect(log.frameClosed).toBe(450);
    expect(log.maxOpenFrames).toBe(1);
    expect(log.sceneDestroyed).toBe(1);
    expect(log.encoderClosed).toBe(1);
    expect(log.hostDisposed).toBe(1);
    expect(log.finished).toBe(1);
    expect(log.muxed).toBe(450);
  });

  it('кадр с недогруженными тайлами повторяется до 2 раз; неполный кадр завершает экспорт ошибкой', async () => {
    const log = newLog();
    await expect(exportVideo(args(), makeDeps(log, { failTiles: (_n, idx) => idx === 10 || idx === 11 })))
      .rejects.toMatchObject({ kind: 'tiles' });
    expect(log.encoded.length).toBe(10);
    expect(log.finished).toBe(0);
    expect(log.rendered.length).toBe(13);
  });

  it('зависший тайл штрафует один раз: подряд неполные кадры дают не больше одного «длинного» ожидания', async () => {
    const log = newLog();
    const bad = (_n: number, idx: number) => idx >= 100 && idx < 140; // 40 кадров подряд, как при тайле, висевшем 12 с
    await expect(exportVideo(args(), makeDeps(log, { failTiles: bad }))).rejects.toMatchObject({ kind: 'tiles' });
    expect(longWaitsThatTimedOut(log)).toBe(1);
    expect(log.timeouts.filter((t) => t === TILE_SLOW_TIMEOUT_MS).length).toBe(2);
    expect(log.timeouts.every((t) => t === TILE_TIMEOUT_MS || t === TILE_SLOW_TIMEOUT_MS)).toBe(true);
    expect(log.rendered.length).toBe(103);
    expect(log.encoded.length).toBe(100);
    expect(log.finished).toBe(0);
  });

  it('кадр дошёл до конца — длинное ожидание возвращается для следующего зависания', async () => {
    const log = newLog();
    const tries = new Map<number, number>();
    const bad = (_n: number, idx: number) => {
      if (idx !== 100 && idx !== 300) return false;
      const attempt = (tries.get(idx) ?? 0) + 1; tries.set(idx, attempt);
      return attempt < 3;
    };
    await exportVideo(args(), makeDeps(log, { failTiles: bad }));
    expect(longWaitsThatTimedOut(log)).toBe(2);
    expect(log.encoded.length).toBe(450);
  });

  it('отмена прерывает зависший sc.render сразу: AbortError, ресурсы освобождены', async () => {
    const log = newLog();
    const ctl = new AbortController();
    const deps = makeDeps(log, { onRender: (n) => { if (n === 5) setTimeout(() => ctl.abort(), 10); }, hangRender: (n) => n === 5 });
    const started = Date.now();
    await expect(exportVideo(args({ signal: ctl.signal }), deps)).rejects.toSatisfy(isAbortError);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(log.rendered.length).toBe(6);
    expect(log.sceneDestroyed).toBe(1);
    expect(log.encoderClosed).toBe(1);
    expect(log.hostDisposed).toBe(1);
    expect(isExportRunning()).toBe(false);
  });

  it('повтор помогает: тайлы пришли со второго повтора — предупреждения нет, stage done', async () => {
    const log = newLog();
    const tries = new Map<number, number>();
    const failTiles = (_n: number, idx: number) => { if (idx !== 5) return false; const k = (tries.get(idx) ?? 0) + 1; tries.set(idx, k); return k <= 2; };
    const res = await exportVideo(args(), makeDeps(log, { failTiles }));
    expect(res.incompleteFrames).toBe(0);
    expect(res.stage).toBe('done');
    expect(log.rendered.length).toBe(450 + 2);
  });

  it.each([true, false])('флаг реконструкции доходит до сцены явно (reconstruction: %s)', async (reconstruction) => {
    const log = newLog();
    await exportVideo(args({ reconstruction }), makeDeps(log));
    expect(log.dataReconstruction).toEqual([reconstruction]);
  });

  it('когда всё загружено — stage done и incompleteFrames 0', async () => {
    const res = await exportVideo(args(), makeDeps(newLog()));
    expect(res.stage).toBe('done');
    expect(res.incompleteFrames).toBe(0);
  });

  it('отмена посреди экспорта: AbortError, сцена, энкодер и хост освобождены, файл не собирается', async () => {
    const log = newLog();
    const ctl = new AbortController();
    const deps = makeDeps(log, { onRender: (n) => { if (n === 100) ctl.abort(); } });
    await expect(exportVideo(args({ signal: ctl.signal }), deps)).rejects.toSatisfy(isAbortError);
    expect(log.rendered.length).toBeLessThan(110);
    expect(log.sceneDestroyed).toBe(1);
    expect(log.encoderClosed).toBe(1);
    expect(log.hostDisposed).toBe(1);
    expect(log.finished).toBe(0);
    expect(log.frameOpen).toBe(0);
  });

  it('отмена до старта не создаёт ни хост, ни сцену', async () => {
    const log = newLog();
    const ctl = new AbortController();
    ctl.abort();
    await expect(exportVideo(args({ signal: ctl.signal }), makeDeps(log))).rejects.toSatisfy(isAbortError);
    expect(log.rendered).toHaveLength(0);
    expect(log.hostDisposed + log.sceneDestroyed + log.encoderClosed).toBe(0);
  });

  it('после отмены следующий экспорт проходит нормально', async () => {
    const ctl = new AbortController();
    await expect(exportVideo(args({ signal: ctl.signal }), makeDeps(newLog(), { onRender: (n) => { if (n === 3) ctl.abort(); } }))).rejects.toBeTruthy();
    const res = await exportVideo(args(), makeDeps(newLog()));
    expect(res.frames).toBe(450);
  });

  it('очередь энкодера: пока encodeQueueSize выше порога, новые кадры не отправляются', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    let queued = 0;
    let maxQueued = 0;
    // энкодер «медленный»: очередь растёт с каждым кадром и разгружается только по событию dequeue
    deps.createEncoder = (init) => {
      const base = fakeEncoder(init, log, {
        size: () => queued,
        onWait: (fn) => { setTimeout(() => { queued = Math.max(0, queued - 4); fn(); }, 1); },
      });
      const encode = base.encode.bind(base);
      base.encode = (frame, opts) => { queued++; maxQueued = Math.max(maxQueued, queued); encode(frame, opts); };
      return base;
    };
    const res = await exportVideo(args(), deps);
    expect(res.frames).toBe(450);
    expect(maxQueued).toBeLessThanOrEqual(10);
  });

  it('без поддержки кодеков — понятная ошибка и ни одной отрисовки', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    deps.detect = async () => ({ supported: false, container: null, codec: null });
    await expect(exportVideo(args(), deps)).rejects.toMatchObject({ kind: 'unsupported', message: expect.stringMatching(/Chrome, Edge или Safari/) });
    expect(log.rendered).toHaveLength(0);
    expect(isExportRunning()).toBe(false);
  });

  it('ошибка энкодера → ExportError(codec) и освобождение ресурсов', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    deps.createEncoder = (init) => {
      let n = 0;
      const base = fakeEncoder(init, log, { size: () => 0 });
      base.encode = () => { if (++n === 5) init.error(new DOMException('encode failed', 'EncodingError')); };
      return base;
    };
    await expect(exportVideo(args(), deps)).rejects.toMatchObject({ name: 'ExportError', kind: 'codec', message: expect.stringContaining('encode failed') });
    expect(log.sceneDestroyed).toBe(1);
    expect(log.encoderClosed).toBe(1);
    expect(log.hostDisposed).toBe(1);
  });

  // ───── надёжность (таск 14)

  it('второй вызов при активном экспорте → ExportError(busy): один encoder и одна scene', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    expect(isExportRunning()).toBe(false);
    const first = exportVideo(args(), deps);
    expect(isExportRunning()).toBe(true);
    const second = exportVideo(args(), deps);
    await expect(second).rejects.toBeInstanceOf(ExportError);
    await expect(second).rejects.toMatchObject({ kind: 'busy' });
    await first;
    expect(log.encodersCreated).toBe(1);
    expect(log.scenesCreated).toBe(1);
    expect(log.hostDisposed).toBe(1);
    expect(isExportRunning()).toBe(false);
  });

  it('флаг активности снимается после отказа и после отмены — следующий экспорт разрешён', async () => {
    const deps = makeDeps(newLog());
    deps.ensureFonts = async () => { throw new FontLoadError('Manrope'); };
    await expect(exportVideo(args(), deps)).rejects.toMatchObject({ kind: 'font' });
    expect(isExportRunning()).toBe(false);
    const ctl = new AbortController();
    await expect(exportVideo(args({ signal: ctl.signal }), makeDeps(newLog(), { onRender: (n) => { if (n === 2) ctl.abort(); } }))).rejects.toSatisfy(isAbortError);
    expect(isExportRunning()).toBe(false);
    expect((await exportVideo(args(), makeDeps(newLog()))).frames).toBe(450);
  });

  it('снимок: смена стиля, настроек и маршрута во время экспорта не попадает в кадры', async () => {
    const log = newLog();
    const a = args();
    const originalLat = a.route.points[0].lat;
    const res = await exportVideo(a, makeDeps(log, {
      onRender: (n) => {
        if (n === 5) {
          a.settings.styleId = 'neon';
          a.settings.info.distance = !a.settings.info.distance;
          a.settings.title = 'Подмена';
          a.route.points[0].lat = originalLat + 1;
        }
      },
    }));
    expect(log.sceneStyles).toEqual(['epic']);
    expect(log.dataSettings).toHaveLength(1);
    expect(log.dataSettings[0].styleId).toBe('epic');
    expect(log.dataSettings[0].title).toBe('Хива');
    expect(log.dataSettings[0].info.distance).not.toBe(a.settings.info.distance);
    expect(log.dataRoutes[0]).not.toBe(a.route);
    expect(log.dataRoutes[0].points[0].lat).toBe(originalLat);
    expect(res.fileName).toBe('route-story_Хива_9x16.mp4');
  });

  it('шрифт не загрузился → ExportError(font) с текстом FontLoadError; ни хоста, ни сцены, ни энкодера', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    deps.ensureFonts = async () => { throw new FontLoadError('Manrope'); };
    const err = await exportVideo(args(), deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExportError);
    expect(err).toMatchObject({ kind: 'font', message: 'Не загрузился шрифт Manrope — проверьте соединение и нажмите «Повторить»' });
    expect(log.scenesCreated + log.encodersCreated + log.hostDisposed + log.rendered.length).toBe(0);
  });

  it('шрифт восстановился — повторный экспорт проходит', async () => {
    let healthy = false;
    const make = () => { const d = makeDeps(newLog()); d.ensureFonts = async () => { if (!healthy) throw new FontLoadError('Manrope'); }; return d; };
    await expect(exportVideo(args(), make())).rejects.toMatchObject({ kind: 'font' });
    healthy = true;
    expect((await exportVideo(args(), make())).stage).toBe('done');
  });

  it('createScene бросил FontLoadError → тоже ExportError(font), ресурсы освобождены', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    deps.createScene = async () => { throw new FontLoadError('PT Serif'); };
    await expect(exportVideo(args(), deps)).rejects.toMatchObject({ kind: 'font', message: expect.stringContaining('PT Serif') });
    expect(log.hostDisposed).toBe(1);
    expect(log.encoderClosed).toBe(1);
  });

  it('энкодер не настроился (configure) → ExportError(codec), ресурсы закрыты', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    deps.createEncoder = (init) => {
      log.encodersCreated++;
      const base = fakeEncoder(init, log, { size: () => 0 });
      base.configure = () => { throw new DOMException('config rejected', 'NotSupportedError'); };
      return base;
    };
    await expect(exportVideo(args(), deps)).rejects.toMatchObject({ kind: 'codec', message: expect.stringContaining('config rejected') });
    expect(log.scenesCreated).toBe(0);
    expect(log.encoderClosed).toBe(1);
    expect(log.hostDisposed).toBe(1);
  });

  it('flush упал → ExportError(codec), файл не собирается', async () => {
    const log = newLog();
    const deps = makeDeps(log);
    deps.createEncoder = (init) => {
      log.encodersCreated++;
      const base = fakeEncoder(init, log, { size: () => 0 });
      base.flush = async () => { throw new DOMException('flush failed', 'EncodingError'); };
      return base;
    };
    await expect(exportVideo(args(), deps)).rejects.toMatchObject({ kind: 'codec' });
    expect(log.finished).toBe(0);
    expect(log.sceneDestroyed).toBe(1);
  });

  it('потеря WebGL посреди экспорта → ExportError(webgl) даже если render завис; ресурсы закрыты, подписка снята', async () => {
    const log = newLog();
    const deps = makeDeps(log, {
      onRender: (n) => { if (n === 20) log.lose?.(); },
      hangRender: (n) => n === 20,
    });
    await expect(exportVideo(args(), deps)).rejects.toMatchObject({ kind: 'webgl', message: expect.stringMatching(/WebGL/) });
    expect(log.rendered.length).toBe(21);
    expect(log.sceneDestroyed).toBe(1);
    expect(log.encoderClosed).toBe(1);
    expect(log.hostDisposed).toBe(1);
    expect(log.unwatched).toBe(1);
    expect(log.finished).toBe(0);
    expect(log.frameOpen).toBe(0);
    expect(isExportRunning()).toBe(false);
  });

  it('этапы: prepare → frames → finalize; finalize объявлен до сборки файла, результат — после него', async () => {
    const log = newLog();
    const seen: ExportProgress[] = [];
    let finishedAtFinalize = -1;
    const res = await exportVideo(args({ onProgress: (p) => { seen.push(p); if (p.stage === 'finalize') finishedAtFinalize = log.finished; } }), makeDeps(log));
    const stages = seen.map((p) => p.stage);
    expect(stages[0]).toBe('prepare');
    expect(stages[stages.length - 1]).toBe('finalize');
    expect([...new Set(stages)]).toEqual(['prepare', 'frames', 'finalize']);
    expect(seen.filter((p) => p.stage === 'frames').map((p) => p.frame)).toEqual(Array.from({ length: 451 }, (_, i) => i));
    expect(seen.every((p) => p.total === 450)).toBe(true);
    expect(finishedAtFinalize).toBe(0);     // на момент «Сборка файла» контейнер ещё не закрыт
    expect(log.finished).toBe(1);
    expect(res.stage).toBe('done');
  });

  it('отмена на этапе подготовки освобождает всё', async () => {
    const log = newLog();
    const ctl = new AbortController();
    const deps = makeDeps(log);
    deps.preloadAssets = async () => { ctl.abort(); };
    await expect(exportVideo(args({ signal: ctl.signal }), deps)).rejects.toSatisfy(isAbortError);
    expect(log.sceneDestroyed).toBe(1);
    expect(log.encoderClosed).toBe(1);
    expect(log.hostDisposed).toBe(1);
    expect(log.rendered).toHaveLength(0);
    expect(isExportRunning()).toBe(false);
  });
});

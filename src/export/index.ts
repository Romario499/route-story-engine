// Экспорт видео: кадр за кадром через скрытую Scene (pixelRatio 2) → WebCodecs VideoEncoder → MP4/WebM.
// Не зависит от частоты кадров экрана и от rAF: цикл — только await render, поэтому идёт и в фоновой вкладке
// (хотя браузер её притормаживает — в интерфейсе предупреждаем).
//
// Гарантии (таск 14):
//   • одновременно идёт один экспорт: второй вызов → ExportError('busy'), ничего не создаёт;
//   • в начале берётся снимок route и settings — правки в интерфейсе во время работы на файл не влияют;
//   • шрифт не загрузился → экспорт не стартует (ExportError('font')), подмены системным шрифтом нет;
//   • кадр с недогруженными тайлами повторяется (до TILE_RETRIES раз, коротко); следующие кадры, пока тайл висит, ждут TILE_SLOW_TIMEOUT_MS
//     без повторов; если неполные кадры остались —
//     результат помечен stage 'done-with-warnings';
//   • сбой энкодера → ExportError('codec'), потеря контекста WebGL → ExportError('webgl'); отмена — AbortError;
//     во всех случаях VideoFrame, энкодер, сцена и скрытый контейнер освобождены, флаг «идёт экспорт» снят.
import { preloadOverlayAssets } from '../render/assets';
import { ensureFonts, FontLoadError } from '../render/fonts';
import { resolveTitle } from '../render/overlay';
import type { Scene } from '../render/scene';
import { buildTimeline, type TimelineOptions } from '../story';
import { DESIGN_SIZE, FPS, type Enrichment, type Format, type Route, type StyleId, type StorySettings } from '../types';
import { ExportError, isExportError } from './errors';
import { createMuxer, mimeTypeFor, type MuxerSpec, type VideoMuxer } from './mux';
import { detectExportSupport, encoderConfigFor, UNSUPPORTED_MESSAGE, type ExportSupport } from './support';
import { createAbortError, estimateEtaSec, exportFileName, isAbortError } from './util';

export { detectExportSupport, UNSUPPORTED_MESSAGE, type ExportSupport } from './support';
export { ExportError, isExportError, type ExportFailureKind } from './errors';
export { createAbortError, exportFileName, formatEta, formatFileSize, isAbortError } from './util';

export type ExportStage = 'prepare' | 'frames' | 'finalize';
export interface ExportProgress { stage: ExportStage; frame: number; total: number; etaSec: number | null }
export interface ExportResult {
  blob: Blob; mimeType: string; fileName: string; frames: number;
  /** Кадры, у которых и после повторов часть тайлов не пришла. */
  incompleteFrames: number;
  /** То же число под прежним именем (T06). */
  tileWarnings: number;
  /** 'done-with-warnings' — файл собран, но на `incompleteFrames` кадрах карта недогружена: «готово» не показывать. */
  stage: 'done' | 'done-with-warnings';
}

export interface ExportArgs {
  route: Route; enrichment: Enrichment; settings: StorySettings;
  /** Маршрут восстановлен по афише (`RouteSource.reconstruction`): в ролике расчётные показатели помечены «расчётно». */
  reconstruction: boolean;
  onProgress(p: ExportProgress): void; signal: AbortSignal;
  /** Параметры раскадровки (отступы общего плана и путешествия) — те же, что у превью: `timelineOptionsFor(format, styleId)`. Обязательны. */
  timelineOptions: TimelineOptions;
}

/** Всё, что экспорт берёт у браузера, — одним объектом: в тестах подменяется. */
export interface ExportDeps {
  createHost(): { host: HTMLElement; dispose(): void };
  /** Строгая загрузка шрифтов (reject FontLoadError); вызывается до создания хоста, энкодера и сцены. */
  ensureFonts(): Promise<void>;
  createScene(host: HTMLElement, opts: { format: Format; styleId: StyleId; pixelRatio: number }): Promise<Scene>;
  /** Подписка на потерю графического контекста сцены (карта WebGL / холст). Возвращает отписку. */
  watchWebglLoss(scene: Scene, onLost: () => void): () => void;
  /** Ресурсы оформления (флаги): без них кадр ушёл бы в файл с заглушкой вместо флага. */
  preloadAssets(enrichment: Enrichment): Promise<void>;
  detect(format: Format): Promise<ExportSupport>;
  createEncoder(init: VideoEncoderInit): Pick<VideoEncoder, 'encodeQueueSize' | 'state' | 'configure' | 'encode' | 'flush' | 'close' | 'addEventListener' | 'removeEventListener'>;
  createVideoFrame(canvas: HTMLCanvasElement, init: { timestamp: number; duration: number }): VideoFrame;
  createMuxer(spec: MuxerSpec): VideoMuxer;
}

/** Выше этой очереди кадры не подаём — иначе несжатые кадры копятся в памяти. */
export const MAX_ENCODE_QUEUE = 6;
/** Ключевой кадр каждые 2 с. */
export const KEYFRAME_INTERVAL = FPS * 2;
export const TILE_TIMEOUT_MS = 10_000;
/** Короткое повторное ожидание в общем бюджете кадра; также бюджет окна прогрева. */
export const TILE_SLOW_TIMEOUT_MS = 2_000;
/** Сколько раз повторить кадр, у которого часть тайлов не пришла (повторы — с коротким ожиданием). */
export const TILE_RETRIES = 2;

export const BUSY_MESSAGE = 'Экспорт уже идёт. Дождитесь его завершения или отмените.';
export const WEBGL_LOST_MESSAGE = 'Видео не удалось собрать: карта потеряла графический контекст (WebGL). Повторите экспорт или перезагрузите страницу.';

let running = false;
/** Идёт ли экспорт прямо сейчас (в этой вкладке он может быть только один). */
export function isExportRunning(): boolean { return running; }

/** Холсты WebGL карт, появившиеся при создании сцены: за ними следим снаружи, не трогая scene.ts. */
const mapCanvasesOf = new WeakMap<Scene, HTMLCanvasElement[]>();

const defaultDeps: ExportDeps = {
  createHost() {
    // Сцена сама ставит host position:relative, поэтому прячем обёртку, а не сам host.
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:fixed;left:-100000px;top:0;width:1px;height:1px;overflow:hidden;pointer-events:none;';
    const host = document.createElement('div');
    wrap.append(host);
    document.body.append(wrap);
    return { host, dispose: () => wrap.remove() };
  },
  ensureFonts,
  async createScene(host, opts) {
    const query = () => Array.from(document.querySelectorAll<HTMLCanvasElement>('canvas.maplibregl-canvas'));
    const before = new Set(query());
    const scene = await (await import('../render/scene')).createScene(host, opts);
    mapCanvasesOf.set(scene, query().filter((c) => !before.has(c)));
    return scene;
  },
  watchWebglLoss(scene, onLost) {
    const targets: { el: EventTarget; type: string }[] = [
      ...(mapCanvasesOf.get(scene) ?? []).map((el) => ({ el, type: 'webglcontextlost' })),
      { el: scene.canvas, type: 'contextlost' },
    ];
    for (const { el, type } of targets) el.addEventListener(type, onLost);
    return () => { for (const { el, type } of targets) el.removeEventListener(type, onLost); };
  },
  preloadAssets: (enrichment) => preloadOverlayAssets(enrichment),
  detect: (format) => detectExportSupport(format),
  createEncoder: (init) => new VideoEncoder(init),
  createVideoFrame: (canvas, init) => new VideoFrame(canvas, init),
  createMuxer,
};

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw createAbortError();
}

/** Дождаться промиса, но выйти сразу с AbortError, если пользователь отменил. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(createAbortError());
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e: unknown) => { signal.removeEventListener('abort', onAbort); reject(e); },
    );
  });
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Сбой энкодера, контейнера или конфигурации → понятная ошибка с действием. Свои ошибки и отмену не трогаем. */
function asCodecError(e: unknown): unknown {
  if (isExportError(e) || isAbortError(e)) return e;
  return new ExportError('codec', `Видео не удалось собрать: ${errorText(e)}. Повторите экспорт или перезагрузите страницу.`, e);
}

function asFontError(e: unknown): unknown {
  if (isExportError(e) || isAbortError(e)) return e;
  return new ExportError('font', errorText(e), e);
}

/**
 * Экспорт ролика. Одновременно может идти только один: повторный вызов сразу отвергается `ExportError('busy')`.
 * route и settings клонируются в начале; enrichment — набор замыканий над неизменяемыми данными, он берётся как есть.
 */
export async function exportVideo(args: ExportArgs, deps: ExportDeps = defaultDeps): Promise<ExportResult> {
  if (running) throw new ExportError('busy', BUSY_MESSAGE);
  running = true;
  try {
    return await runExport(args, deps);
  } finally {
    running = false;
  }
}

async function runExport(args: ExportArgs, deps: ExportDeps): Promise<ExportResult> {
  const { onProgress, signal, enrichment } = args;
  throwIfAborted(signal);

  // снимок: дальше store и объекты вызывающего кода не читаются
  const route = structuredClone(args.route);
  const settings = structuredClone(args.settings);
  const timelineOptions = { ...args.timelineOptions };

  const size = DESIGN_SIZE[settings.format];
  const timeline = buildTimeline(route, enrichment, settings, timelineOptions);
  const total = timeline.frameCount;
  const frameDurationUs = Math.round(1e6 / FPS);
  const emit = (stage: ExportStage, frame: number, etaSec: number | null) => onProgress({ stage, frame, total, etaSec });

  emit('prepare', 0, null);

  const support = await deps.detect(settings.format);
  if (!support.supported || !support.container || !support.codec) throw new ExportError('unsupported', UNSUPPORTED_MESSAGE);
  throwIfAborted(signal);
  const { container, codec } = support;

  // шрифт — до любых ресурсов: без него экспорт не стартует и не подменяет его системным
  try {
    await abortable(deps.ensureFonts(), signal);
  } catch (e) {
    throw asFontError(e);
  }
  throwIfAborted(signal);

  const { host, dispose: disposeHost } = deps.createHost();
  let scene: Scene | null = null;
  let encoder: ReturnType<ExportDeps['createEncoder']> | null = null;
  let encoderError: unknown = null;
  let unwatch: (() => void) | null = null;
  try {
    let muxer: VideoMuxer;
    try {
      muxer = deps.createMuxer({ container, codec, width: size.width, height: size.height });
    } catch (e) {
      throw asCodecError(e);
    }
    try {
      encoder = deps.createEncoder({
        output: (chunk, meta) => { muxer.addChunk(chunk, meta); },
        error: (e) => { encoderError = e; },
      });
      encoder.configure(encoderConfigFor(codec, settings.format));
    } catch (e) {
      throw asCodecError(e);
    }
    const enc = encoder;
    const checkEncoder = () => { if (encoderError) throw asCodecError(encoderError); };

    try {
      scene = await deps.createScene(host, { format: settings.format, styleId: settings.styleId, pixelRatio: 2 });
    } catch (e) {
      throw e instanceof FontLoadError ? asFontError(e) : e;
    }
    const sc = scene;
    throwIfAborted(signal);

    // потеря контекста WebGL: render при этом может зависнуть, поэтому ждущие вызовы гонятся с этим промисом
    let lostError: ExportError | null = null;
    let rejectLost: (e: ExportError) => void = () => {};
    const lost = new Promise<never>((_, reject) => { rejectLost = reject; });
    lost.catch(() => {}); // не «необработанный отказ»: ошибку заберёт guard или checkLost
    unwatch = deps.watchWebglLoss(sc, () => {
      lostError ??= new ExportError('webgl', WEBGL_LOST_MESSAGE);
      rejectLost(lostError);
    });
    const guard = <T>(work: Promise<T>): Promise<T> => Promise.race([work, lost]);
    const checkLost = () => { if (lostError) throw lostError; };

    sc.setData(route, enrichment, settings, args.reconstruction);
    // шрифты ждали выше; флаги — здесь, до первого кадра
    await guard(abortable(deps.preloadAssets(enrichment), signal));
    throwIfAborted(signal);

    /** Ждём, пока энкодер разгрузит очередь (событие dequeue; страховочный таймер — на случай, если оно не придёт). */
    const waitForQueue = async () => {
      while (enc.encodeQueueSize > MAX_ENCODE_QUEUE) {
        checkEncoder();
        checkLost();
        throwIfAborted(signal);
        await guard(new Promise<void>((resolve) => {
          let done = false;
          const finish = () => { if (done) return; done = true; enc.removeEventListener('dequeue', finish); clearTimeout(timer); resolve(); };
          const timer = setTimeout(finish, 50);
          enc.addEventListener('dequeue', finish);
        }));
      }
    };

    const incompleteFrames = 0;
    // Детерминированная траектория: прогрев включает границы сцен и промежуточные позиции окна.
    const frames = Array.from({ length: total }, (_, i) => timeline.frameAt(i / FPS));
    const windowFrames = Math.round(0.75 * FPS);
    const startedAt = performance.now();
    emit('frames', 0, null);

    for (let i = 0; i < total; i++) {
      throwIfAborted(signal);
      checkLost();
      checkEncoder();
      if (sc.warmup && i % windowFrames === 0) {
        const end = Math.min(total - 1, i + windowFrames);
        const samples = new Set([i, Math.round((i + end) / 2), end]);
        for (let k = i + 1; k <= end; k++) if (frames[k].shot?.kind !== frames[k - 1].shot?.kind) samples.add(k);
        await guard(abortable(sc.warmup([...samples].sort((a, b) => a - b).map(k => frames[k]),
          { timeoutMs: TILE_SLOW_TIMEOUT_MS }), signal));
      }
      const frameState = frames[i];
      const renderOnce = async (timeoutMs: number) =>
        (await guard(abortable(sc.render(frameState, { waitForTiles: true, timeoutMs }), signal))).tilesComplete;

      let tilesComplete = await renderOnce(TILE_TIMEOUT_MS);
      for (let retry = 0; !tilesComplete && retry < TILE_RETRIES; retry++) {
        throwIfAborted(signal);
        tilesComplete = await renderOnce(TILE_SLOW_TIMEOUT_MS);
      }
      if (!tilesComplete) throw new ExportError('tiles',
        `Карта кадра ${i + 1} не загрузилась за отведённое время. Проверьте соединение и повторите экспорт.`);
      throwIfAborted(signal);
      checkLost();

      await waitForQueue();
      const videoFrame = deps.createVideoFrame(sc.canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: frameDurationUs });
      try {
        enc.encode(videoFrame, { keyFrame: i % KEYFRAME_INTERVAL === 0 });
      } catch (e) {
        throw asCodecError(e);
      } finally {
        videoFrame.close();
      }

      const done = i + 1;
      emit('frames', done, estimateEtaSec(done, total, performance.now() - startedAt));
    }

    // «Сборка файла»: «готово» возможно только после того, как контейнер закрыт
    throwIfAborted(signal);
    checkLost();
    emit('finalize', total, 0);
    try {
      await guard(enc.flush());
    } catch (e) {
      throw asCodecError(e);
    }
    checkEncoder();
    throwIfAborted(signal);
    let blob: Blob;
    try {
      blob = muxer.finish();
    } catch (e) {
      throw asCodecError(e);
    }
    return {
      blob,
      mimeType: mimeTypeFor(container),
      fileName: exportFileName(resolveTitle(settings.lang, settings.title, route, enrichment), settings.format, container),
      frames: total,
      incompleteFrames,
      tileWarnings: incompleteFrames,
      stage: incompleteFrames > 0 ? 'done-with-warnings' : 'done',
    };
  } finally {
    unwatch?.();
    try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* уже закрыт */ }
    scene?.destroy();
    disposeHost();
  }
}

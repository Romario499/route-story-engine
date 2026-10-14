// Сцена студии: живое превью (тот же рендерер, что и в экспорте), транспорт, место под панель экспорта.
// Превью — сцена в CSS-размере MAP_VIEWPORT, уменьшенная transform: scale(): кадрирование совпадает с файлом.
// Размер кадра считается из доступной области (ResizeObserver), а не из фиксированной высоты.
// Контейнер `#export-slot` — для панели экспорта (монтирует src/main.ts).
import { preloadOverlayAssets } from '../render/assets';
import { FontLoadError } from '../render/fonts';
import { safeZoneFractions, timelineOptionsFor } from '../render/layout';
import { createScene, type Scene } from '../render/scene';
import { buildTimeline, type Timeline } from '../story';
import { DESIGN_SIZE, FPS, MAP_VIEWPORT, type Enrichment, type Format, type Route, type StyleId } from '../types';
import { h, icon } from './dom';
import type { AppState, Store } from './state';
import { actFill, actSegmentsOf, seekTimeFor, type ActSegment } from './studio/acts';
import { fitFrame, SINGLE_COLUMN_MAX_HEIGHT_RATIO, SINGLE_COLUMN_QUERY } from './studio/frame-fit';
import { sceneSegmentsOf, type SceneSegment } from './studio/scenes';

const PREVIEW_PIXEL_RATIO = 1;
export const PREVIEW_FAILED_MESSAGE = 'Не удалось построить превью. Повторите, выберите другой стиль или формат либо загрузите маршрут ещё раз.';
/** Предел «прыжка» времени между кадрами (вкладка была скрыта), с. */
const MAX_STEP_SEC = 0.1;

const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface PreviewStats { frames: number; fps: number; avgRenderMs: number }

/** Части сцены: область кадра, транспорт, полоса актов и место под экспорт — app.ts раскладывает их по колонкам. */
export interface PreviewParts { view: HTMLElement; transport: HTMLElement; acts: HTMLElement; slot: HTMLElement }

export function createPreviewStep(store: Store): PreviewParts {
  const placeholder = h('div', { class: 'preview__placeholder', 'data-testid': 'preview-placeholder' },
    icon('image', 'icon preview__placeholder-icon'),
    h('div', { class: 'preview__placeholder-title', text: 'Здесь появится ролик' }),
    h('p', { text: 'Загрузите трек или откройте пример — кадр появится здесь, и его можно будет настроить.' }),
  );
  const loading = h('div', { class: 'preview__loading', hidden: true, role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { text: 'Готовлю карту…' }));
  const host = h('div', { class: 'preview__host' });

  // сообщение об ошибке превью: иконка + текст + «Повторить» (не только цвет)
  const errorText = h('div', { class: 'notice__text' });
  const retryBtn = h('button', { type: 'button', class: 'button button--ghost', 'data-testid': 'preview-retry', text: 'Повторить' });
  const errorBox = h('div', { class: 'notice notice--error preview__notice', role: 'alert', hidden: true, 'data-testid': 'preview-error' },
    icon('alert', 'icon notice__icon'),
    h('div', { class: 'notice__body' }, errorText, retryBtn),
  );
  const showError = (message: string | null) => {
    errorBox.hidden = message === null;
    errorText.textContent = message ?? '';
  };

  const safeZones = h('div', { class: 'safe-zones', hidden: true, 'aria-hidden': 'true' },
    h('div', { class: 'safe-zones__band safe-zones__band--top' }),
    h('div', { class: 'safe-zones__band safe-zones__band--bottom' }),
    h('div', { class: 'safe-zones__band safe-zones__band--right' }),
    h('div', { class: 'safe-zones__band safe-zones__band--left' }),
  );
  host.append(safeZones);
  const frameBox = h('div', { class: 'preview__frame', hidden: true }, host);
  const backdrop = h('canvas', { class: 'preview__backdrop', width: 240, height: 160, 'aria-hidden': 'true', hidden: true });
  const stage = h('div', { class: 'preview__stage' }, backdrop, placeholder, frameBox, loading, errorBox);
  const caption = h('div', { class: 'stage__caption', 'data-testid': 'preview-format' });
  const formatButtons = (['9:16', '16:9'] as const).map(format => {
    const button = h('button', { type: 'button', class: 'preview-mode', text: format, 'aria-label': `Формат превью ${format}` });
    button.addEventListener('click', () => store.updateSettings({ format }));
    return button;
  });
  const fullscreen = h('button', { type: 'button', class: 'preview-fullscreen', text: '⛶', title: 'Полный экран', 'aria-label': 'Полный экран' });
  const toolbar = h('div', { class: 'preview-toolbar' },
    h('strong', { text: 'Предпросмотр' }),
    h('div', { class: 'preview-modes', role: 'group', 'aria-label': 'Формат предпросмотра' }, ...formatButtons), fullscreen,
  );
  const view = h('div', { class: 'stage__view' }, toolbar, stage, caption);
  fullscreen.addEventListener('click', () => {
    const action = document.fullscreenElement ? document.exitFullscreen() : view.requestFullscreen();
    void action.catch(() => showError('Полный экран недоступен в этом окне браузера.'));
  });

  const playBtn = h('button', { type: 'button', class: 'button button--ghost button--round', 'data-testid': 'play', disabled: true, 'aria-label': 'Пуск', title: 'Пуск' },
    icon('play', 'icon icon--play'), icon('pause', 'icon icon--pause'));
  const restartBtn = h('button', { type: 'button', class: 'button button--ghost button--round', 'data-testid': 'restart', disabled: true, 'aria-label': 'Сначала', title: 'Сначала' },
    icon('restart', 'icon'));
  const seek = h('input', { type: 'range', class: 'seek', min: 0, max: 1000, value: 0, step: 1, 'data-testid': 'seek', disabled: true, 'aria-label': 'Перемотка' });
  const timeLabel = h('span', { class: 'transport__time', 'data-testid': 'timecode', text: '0:00 / 0:00' });
  const transport = h('div', { class: 'transport' }, playBtn, restartBtn, seek, timeLabel);

  // Полоса актов: read-only, из реального Timeline; клик — переход к началу акта (история 132). Никаких дорожек и ползунков.
  const acts = h('section', { class: 'acts', id: 'studio-scenes', 'aria-label': 'Сцены ролика', 'data-testid': 'acts', hidden: true });
  const actRow = h('div', { class: 'acts__row', role: 'group', 'aria-label': 'Акты ролика' });
  const scenesRow = h('div', { class: 'scenes__row', role: 'group', 'aria-label': 'Автоматические сцены', 'data-testid': 'scenes' });
  let scenes: SceneSegment[] = [];
  let sceneButtons: HTMLButtonElement[] = [];
  let actSegments: ActSegment[] = [];
  let actButtons: HTMLButtonElement[] = [];
  const renderActs = () => {
    actSegments = timeline ? actSegmentsOf(timeline) : [];
    actButtons = actSegments.map((seg) => {
      const b = h('button', {
        type: 'button', class: 'acts__seg', 'data-testid': `act-${seg.id}`, 'data-act': seg.id,
        style: `flex-grow: ${seg.end - seg.start}`,
        'aria-label': `${seg.label}, с ${fmtTime(seg.start)}`,
      },
        h('span', { class: 'acts__name', text: seg.label }),
        h('span', { class: 'acts__time', text: `${fmtTime(seg.start)}–${fmtTime(seg.end)}` }),
      );
      b.addEventListener('click', () => {
        if (!timeline) return;
        t = seekTimeFor(actSegments, seg.id);
        dirty = true;
        syncTransport();
      });
      return b;
    });
    scenes = timeline ? sceneSegmentsOf(timeline, store.get().settings.lang) : [];
    sceneButtons = scenes.map(seg => {
      const canvas = h('canvas', { class: 'scene__thumb', width: 160, height: 90, 'aria-hidden': 'true' });
      const button = h('button', { type: 'button', class: 'scene', 'data-testid': `scene-${seg.kind}`, 'data-time': seg.start,
        'aria-label': `${seg.label}, с ${fmtTime(seg.start)}` }, canvas,
        h('span', { class: 'scene__name', text: seg.label }), h('span', { class: 'scene__time', text: `${fmtTime(seg.start)}–${fmtTime(seg.end)}` }));
      button.addEventListener('click', () => { if (!timeline) return; t = seg.start; dirty = true; syncTransport(); });
      return button;
    });
    actRow.replaceChildren(...actButtons);
    scenesRow.replaceChildren(...sceneButtons);
    acts.replaceChildren(h('div', { class: 'scenes__head' }, h('h2', { text: 'Сцены' }), h('span', { text: 'Собраны автоматически' })), scenesRow, actRow);
    acts.hidden = actButtons.length === 0;
  };

  // Пока панель экспорта не смонтирована (и если не смонтируется) — понятная заглушка на месте экспорта.
  const slot = h('div', { class: 'export-slot', 'data-testid': 'export-slot', id: 'export-slot' },
    h('button', { type: 'button', class: 'button button--primary export-button', disabled: true, text: 'Экспортировать ролик' }),
    h('p', { class: 'export-hint', text: 'Сначала загрузите маршрут' }),
  );

  // ───── состояние проигрывателя
  let scene: Scene | null = null;
  let sceneToken = 0;
  let timeline: Timeline | null = null;
  let timelineKey = '';
  let t = 0;
  let playing = false;
  let dirty = true;
  let warming = false; // ждём тайлы первого кадра — обычную отрисовку не запускаем
  let thumbnailKey = '';
  let lastTs = 0;
  function paintBackdrop(): void {
    if (!scene) return;
    const ctx = backdrop.getContext('2d');
    if (ctx) ctx.drawImage(scene.canvas, 0, 0, backdrop.width, backdrop.height);
    backdrop.hidden = false;
  }

  const stats: PreviewStats = { frames: 0, fps: 0, avgRenderMs: 0 };
  (window as unknown as { __routeStoryPreview?: PreviewStats }).__routeStoryPreview = stats;
  let fpsWindowStart = performance.now();
  let fpsWindowFrames = 0;
  let renderMsAcc = 0;

  // для отладки и снимков в режиме разработки (scripts/make-style-thumbs.mjs)
  if (import.meta.env.DEV) {
    Object.defineProperty(window, '__rs', { value: { get scene() { return scene; }, get timeline() { return timeline; } }, configurable: true });
  }

  const setPlaying = (v: boolean) => {
    playing = v;
    playBtn.classList.toggle('is-playing', v);
    playBtn.setAttribute('aria-label', v ? 'Пауза' : 'Пуск');
    playBtn.title = v ? 'Пауза' : 'Пуск';
  };
  setPlaying(false);

  const syncTransport = () => {
    const dur = timeline?.durationSec ?? 0;
    seek.value = dur > 0 ? String(Math.round((t / dur) * 1000)) : '0';
    timeLabel.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;
    seek.setAttribute('aria-valuetext', timeLabel.textContent);
    actSegments.forEach((seg, i) => {
      const fill = actFill(seg, t);
      actButtons[i].style.setProperty('--fill', `${(fill * 100).toFixed(1)}%`);
      const current = t >= seg.start && (t < seg.end || i === actSegments.length - 1);
      if (current) actButtons[i].setAttribute('aria-current', 'true'); else actButtons[i].removeAttribute('aria-current');
    });
    scenes.forEach((seg, i) => {
      sceneButtons[i].setAttribute('aria-pressed', String(t >= seg.start && (t < seg.end || i === scenes.length - 1)));
    });
  };

  // ───── размер кадра: из доступной области сцены
  const singleColumn = window.matchMedia(SINGLE_COLUMN_QUERY);
  function applyScale(): void {
    const s = store.get().settings;
    const vp = MAP_VIEWPORT[s.format];
    // одна колонка: ширину даёт колонка, высоту ограничиваем окном — за кадром остаются видны транспорт и настройки
    const mobileLimit = window.innerHeight * SINGLE_COLUMN_MAX_HEIGHT_RATIO;
    const availH = singleColumn.matches ? Math.min(stage.clientHeight || mobileLimit, mobileLimit) : stage.clientHeight;
    const fit = fitFrame({ width: stage.clientWidth || vp.width, height: availH || vp.height }, vp);
    host.style.transform = `scale(${fit.scale})`;
    host.style.transformOrigin = 'top left';
    frameBox.style.width = `${fit.width}px`;
    frameBox.style.height = `${fit.height}px`;
  }
  new ResizeObserver(() => applyScale()).observe(stage);
  window.addEventListener('resize', applyScale);

  function renderFrame(): void {
    if (!scene || !timeline) return;
    const t0 = performance.now();
    const frame = timeline.frameAt(t);
    scene.render(frame, { waitForTiles: false }).then(paintBackdrop).catch((err: unknown) => {
      console.error('Сбой отрисовки кадра:', err);
      showError(PREVIEW_FAILED_MESSAGE);
    });
    const ms = performance.now() - t0;
    stats.frames++;
    renderMsAcc += ms;
    fpsWindowFrames++;
    const now = performance.now();
    if (now - fpsWindowStart >= 1000) {
      stats.fps = (fpsWindowFrames * 1000) / (now - fpsWindowStart);
      stats.avgRenderMs = renderMsAcc / fpsWindowFrames;
      fpsWindowStart = now; fpsWindowFrames = 0; renderMsAcc = 0;
    }
  }

  function tick(ts: number): void {
    requestAnimationFrame(tick);
    const dt = lastTs ? Math.min(MAX_STEP_SEC, (ts - lastTs) / 1000) : 0;
    lastTs = ts;
    if (!scene || !timeline || warming) return;
    if (playing) {
      t += dt;
      if (t >= timeline.durationSec) { t = timeline.durationSec; setPlaying(false); }
      dirty = true;
    } else {
      lastTs = 0; // после паузы не копить «прыжок»
    }
    if (dirty) {
      dirty = false;
      renderFrame();
      syncTransport();
    }
  }
  requestAnimationFrame(tick);

  // ───── управление
  playBtn.addEventListener('click', () => {
    if (!timeline) return;
    if (!playing && t >= timeline.durationSec - 1 / FPS) t = 0;
    setPlaying(!playing);
    dirty = true;
  });
  restartBtn.addEventListener('click', () => {
    t = 0; setPlaying(true); dirty = true;
  });
  seek.addEventListener('input', () => {
    if (!timeline) return;
    t = (Number(seek.value) / 1000) * timeline.durationSec;
    dirty = true;
  });

  // ───── связь с состоянием приложения
  let sceneFormat: Format | null = null;
  let sceneStyle: StyleId | null = null;
  let dataRoute: Route | null = null;
  let dataEnrichment: Enrichment | null = null;

  async function ensureScene(state: AppState): Promise<void> {
    const { format, styleId } = state.settings;
    if (scene && sceneFormat === format) {
      if (sceneStyle !== styleId) { sceneStyle = styleId; await scene.setStyle(styleId); }
      return;
    }
    const token = ++sceneToken;
    scene?.destroy();
    scene = null;
    sceneFormat = null;
    loading.hidden = false;
    const next = await createScene(host, { format, styleId, pixelRatio: PREVIEW_PIXEL_RATIO });
    if (token !== sceneToken) { next.destroy(); return; } // пока строили, формат сменили ещё раз
    next.canvas.setAttribute('data-testid', 'preview-canvas');
    scene = next;
    sceneFormat = format;
    sceneStyle = styleId;
    dataRoute = null; // новой сцене нужны данные
    applyScale();
  }

  let busy = false;
  let again = false;
  async function sync(state: AppState): Promise<void> {
    if (busy) { again = true; return; }
    busy = true;
    try {
      const { route, enrichment, settings } = state;
      safeZones.hidden = !settings.showSafeZones;
      const z = safeZoneFractions(settings.format); // из той же раскладки, по которой рисует оверлей
      safeZones.style.setProperty('--sz-top', `${z.top * 100}%`);
      safeZones.style.setProperty('--sz-bottom', `${z.bottom * 100}%`);
      safeZones.style.setProperty('--sz-right', `${z.right * 100}%`);
      safeZones.style.setProperty('--sz-left', `${z.left * 100}%`);
      if (!route || !enrichment) {
        // Пока участок не выбран/не обогащён, прежний ролик не показываем как текущий.
        placeholder.hidden = false; frameBox.hidden = true; acts.hidden = true; backdrop.hidden = true;
        setPlaying(false);
        for (const el of [playBtn, restartBtn, seek]) el.disabled = true;
        return;
      }
      placeholder.hidden = true;
      frameBox.hidden = false;

      const newData = route !== dataRoute || enrichment !== dataEnrichment;
      const key = `${settings.format}|${settings.styleId}|${settings.durationSec}|${settings.lang}`;
      if (!timeline || newData || key !== timelineKey) {
        const frac = timeline && !newData ? t / timeline.durationSec : 0;
        timeline = buildTimeline(route, enrichment, settings, timelineOptionsFor(settings.format, settings.styleId));
        timelineKey = key;
        t = frac * timeline.durationSec;
        renderActs();
      }
      applyScale();
      const hadScene = scene;
      await ensureScene(state);
      if (!scene) return;
      scene.setData(route, enrichment, settings, state.source?.reconstruction === true);
      if (newData || scene !== hadScene) {
        dataRoute = route; dataEnrichment = enrichment;
        if (newData) t = 0;
        // первый кадр показываем с догруженной картой, дальше — как успеет
        loading.hidden = false;
        warming = true;
        try {
          await preloadOverlayAssets(enrichment); // флаги — до первого кадра
          await scene.render(timeline.frameAt(t), { waitForTiles: true, timeoutMs: 4000 });
        } finally { warming = false; }
        loading.hidden = true;
        if (newData) setPlaying(true);
      }
      const thumbsKey = `${key}|${settings.title}|${settings.author}|${JSON.stringify(settings.info)}`;
      if (newData || thumbsKey !== thumbnailKey) {
        warming = true;
        loading.hidden = false;
        try {
          // Кадры той же сцены, последовательно на одном ctx; затем восстановить выбранное время.
          // Не отдельный рендерер и не иллюстрации: миниатюры совпадают с настоящим роликом.
          for (let i = 0; i < scenes.length; i++) {
            await scene.render(timeline.frameAt(scenes[i].sampleAt), { waitForTiles: true, timeoutMs: 1200 });
            const canvas = sceneButtons[i].querySelector('canvas')!;
            const ctx = canvas.getContext('2d');
            if (ctx) { ctx.drawImage(scene.canvas, 0, 0, canvas.width, canvas.height); canvas.dataset.captured = 'true'; }
          }
          await scene.render(timeline.frameAt(t), { waitForTiles: false });
          paintBackdrop();
          thumbnailKey = thumbsKey;
        } finally { warming = false; }
      }
      loading.hidden = true;
      for (const el of [playBtn, restartBtn, seek]) el.disabled = false;
      dirty = true;
      syncTransport();
      showError(null);
    } catch (err) {
      // сбой сцены, шрифта или оформления: индикатор гасим, прошлый ролик (если был) остаётся на экране
      console.error('Сбой превью:', err);
      loading.hidden = true;
      warming = false;
      showError(err instanceof FontLoadError ? err.message : PREVIEW_FAILED_MESSAGE);
    } finally {
      busy = false;
      if (again) { again = false; void sync(store.get()); }
    }
  }

  retryBtn.addEventListener('click', () => { showError(null); void sync(store.get()); });
  store.subscribe((s) => { void sync(s); });
  void sync(store.get());

  const syncCaption = (s: AppState) => {
    const d = DESIGN_SIZE[s.settings.format];
    const label = s.settings.format === '9:16' ? '9:16 · Reels и Shorts' : '16:9 · YouTube';
    caption.textContent = `${label} · ${d.width}×${d.height}`;
    formatButtons.forEach((button, i) => button.setAttribute('aria-pressed', String((i === 0 ? '9:16' : '16:9') === s.settings.format)));
  };
  store.subscribe(syncCaption);
  syncCaption(store.get());
  // формат сменился — кадр другой формы: пересчитать размер сразу, не дожидаясь ResizeObserver
  store.subscribe((s, prev) => { if (s.settings.format !== prev.settings.format) applyScale(); });

  return { view, transport, acts, slot };
}

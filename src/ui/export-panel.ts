// Панель экспорта в шаге 3: кнопка, этапы «Подготовка → Кадры → Сборка файла», «Отменить», готовый ролик со скачиванием.
// Прогресс и ошибки экспорта хранятся здесь же (store.status — это статус импорта маршрута).
//
// Блокировка настроек на время экспорта — DOM-флаг, а не store: на <html> ставится data-exporting="true",
// шаги «Маршрут» и «Стиль» получают атрибут inert (нельзя ни кликнуть, ни сфокусировать), кнопки просмотра тоже.
// Экспорт при этом читает снимок настроек, сделанный в момент нажатия (и сам делает ещё один — в `exportVideo`).
//
// «Готово» показывается только после результата `exportVideo` (он возвращается после закрытия контейнера).
// Результат с неполной картой — «Готово с предупреждением» + «Повторить экспорт», файл не скачивается сам.
// Ссылка на файл (blob URL) освобождается при новом экспорте и при уходе со страницы; «Скачать» работает сколько угодно раз.
import './export-panel.css';
import {
  detectExportSupport, exportVideo, formatFileSize, isAbortError, isExportRunning, UNSUPPORTED_MESSAGE,
  type ExportProgress, type ExportResult, type ExportStage, type ExportSupport,
} from '../export';
import { describeProgress, exportErrorView, STAGE_LABELS, warningText, type ErrorView } from '../export/messages';
import { timelineOptionsFor } from '../render/layout';
import { EXPORT_BITRATE } from '../export/support';
import { DESIGN_SIZE, FPS } from '../types';
import { h } from './dom';
import type { AppState, Store } from './state';
import { SINGLE_COLUMN_QUERY, WIDE_QUERY } from './studio/frame-fit';

/** Элементы, замораживаемые на время экспорта. */
const LOCKED_SELECTORS = ['#step-route', '#step-style', '#step-content', '.transport', '.acts', '.preview-toolbar'];
const STAGES: ExportStage[] = ['prepare', 'frames', 'finalize'];
const TAB_HIDDEN_TEXT = 'Вкладка свёрнута — экспорт может замедлиться';

function setLocked(locked: boolean): void {
  const root = document.documentElement;
  if (locked) root.dataset.exporting = 'true'; else delete root.dataset.exporting;
  for (const sel of LOCKED_SELECTORS) {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
      el.toggleAttribute('inert', locked);
      el.classList.toggle('is-export-locked', locked);
    });
  }
}

/** Просмотр играет в той же вкладке и отнимает у экспорта GPU: ставим на паузу. */
function pausePreview(): void {
  const play = document.querySelector<HTMLElement>('[data-testid="play"].is-playing');
  play?.click();
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'exporting'; progress: ExportProgress }
  | { kind: 'done'; result: ExportResult; url: string }
  | { kind: 'error'; view: ErrorView }
  | { kind: 'cancelled' };

export function createExportPanel(store: Store): HTMLElement {
  let ui: PanelState = { kind: 'idle' };
  let support: ExportSupport | null = null;
  let supportFormat: string | null = null;
  let controller: AbortController | null = null;
  let lastUrl: string | null = null;

  const root = h('div', { class: 'export-panel', 'data-testid': 'export-panel' });

  async function refreshSupport(state: AppState): Promise<void> {
    const format = state.settings.format;
    if (supportFormat === format && support) return;
    supportFormat = format;
    const s = await detectExportSupport(format);
    if (supportFormat !== format) return;
    support = s;
    if (ui.kind !== 'exporting') render();
  }

  function triggerDownload(url: string, fileName: string): void {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
  }

  function releaseUrl(): void {
    if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  }

  async function start(): Promise<void> {
    // кнопка заблокирована, но защита нужна и в коде: ещё один запуск — это ещё один энкодер и сцена
    if (ui.kind === 'exporting' || isExportRunning()) return;
    const state = store.get();
    if (!state.route || !state.enrichment) return;
    const { route, enrichment } = state;
    const reconstruction = state.source?.reconstruction === true;
    const settings = { ...state.settings, info: { ...state.settings.info } };

    releaseUrl();
    const ctl = new AbortController();
    controller = ctl;
    try {
      // пауза, блокировка и первая отрисовка — внутри try: сбой любого шага не оставит страницу заблокированной (inert, data-exporting)
      pausePreview();
      setLocked(true);
      ui = { kind: 'exporting', progress: { stage: 'prepare', frame: 0, total: Math.round(settings.durationSec * FPS), etaSec: null } };
      render();
      const result = await exportVideo({
        route, enrichment, settings, signal: ctl.signal,
        reconstruction,
        timelineOptions: timelineOptionsFor(settings.format, settings.styleId),
        onProgress: (progress) => { if (ui.kind === 'exporting') { ui = { kind: 'exporting', progress }; renderProgress(); } },
      });
      const url = URL.createObjectURL(result.blob);
      lastUrl = url;
      ui = { kind: 'done', result, url };
      setLocked(false);
      render();
      // файл с неполной картой сам не скачиваем: пользователь сначала увидит предупреждение
      if (result.stage === 'done') triggerDownload(url, result.fileName);
    } catch (e) {
      if (isAbortError(e)) ui = { kind: 'cancelled' };
      else ui = { kind: 'error', view: exportErrorView(e) };
      setLocked(false);
      render();
    } finally {
      if (controller === ctl) controller = null;
    }
  }

  // ───── ход экспорта
  const barFill = h('div', { class: 'export-bar__fill' });
  const bar = h('div', { class: 'export-bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 }, barFill);
  const progressText = h('div', { class: 'export-progress__text', 'data-testid': 'export-progress-text', 'aria-live': 'polite' });
  const tabNote = h('p', { class: 'export-tab-note', 'data-testid': 'export-tab-hidden', role: 'status', hidden: true, text: TAB_HIDDEN_TEXT });
  const stageItems = new Map<ExportStage, HTMLElement>(
    STAGES.map((s) => [s, h('li', { class: 'export-stages__item', 'data-stage': s, text: STAGE_LABELS[s] })]),
  );
  const stageList = h('ol', { class: 'export-stages', 'data-testid': 'export-stages' }, ...stageItems.values());

  function syncTabNote(): void {
    tabNote.hidden = !(document.hidden && ui.kind === 'exporting');
  }
  document.addEventListener('visibilitychange', syncTabNote);

  function renderProgress(): void {
    if (ui.kind !== 'exporting') return;
    const view = describeProgress(ui.progress);
    barFill.style.width = `${view.percent}%`;
    bar.setAttribute('aria-valuenow', String(view.percent));
    progressText.textContent = view.text;
    const current = STAGES.indexOf(view.stage);
    STAGES.forEach((s, i) => stageItems.get(s)?.setAttribute('data-state', i < current ? 'done' : i === current ? 'active' : 'todo'));
    root.querySelector('[data-testid="export-progress"]')?.setAttribute('data-stage', view.stage);
    syncTabNote();
  }

  // уход со страницы: во время экспорта браузер предупредит (файл не сохранится), готовый blob освобождаем
  window.addEventListener('beforeunload', (e) => {
    if (ui.kind !== 'exporting') return;
    e.preventDefault();
    e.returnValue = ''; // обязательно для Chrome/Edge; текст браузер показывает свой
  });
  window.addEventListener('pagehide', (e) => { if (!e.persisted) releaseUrl(); });

  // ───── готовый ролик: соседом прямо над #export-slot, вне липкой полосы — иначе полоса выше трети окна и основное
  // действие уходит с первого экрана (UI-01). Сцену не трогает: на широких раскладках ролик в правой колонке, как раньше.
  const resultHost = h('section', { class: 'export-result', 'data-testid': 'export-result', 'aria-label': 'Готовый ролик', hidden: true });
  function placeResult(): void {
    const slot = root.parentElement; // #export-slot; при смене раскладки студия переносит его в другую колонку
    if (slot?.parentElement) { if (resultHost.nextElementSibling !== slot) slot.before(resultHost); }
    else if (resultHost.parentElement !== root) root.append(resultHost); // панель вне студии — под панелью
  }
  // studio (app.ts) переставляет #export-slot по этим же запросам; ролик догоняет его после перестановки
  for (const q of [WIDE_QUERY, SINGLE_COLUMN_QUERY]) {
    window.matchMedia(q).addEventListener('change', () => setTimeout(() => { if (!resultHost.hidden) placeResult(); }, 0));
  }
  function showResult(done: { url: string; fileName: string } | null): void {
    if (!done) {
      resultHost.hidden = true;
      resultHost.replaceChildren();
      delete resultHost.dataset.url;
      return;
    }
    placeResult();
    if (resultHost.dataset.url === done.url) { resultHost.hidden = false; return; } // тот же файл — видео не перезапускаем
    const video = h('video', { class: 'export-video', controls: true, playsinline: true, loop: true, preload: 'auto', 'data-testid': 'export-video' });
    video.src = done.url;
    resultHost.dataset.url = done.url;
    resultHost.replaceChildren(h('div', { class: 'export-result__title', text: `Готовый ролик · ${done.fileName}` }), video);
    resultHost.hidden = false;
  }

  // ───── отрисовка
  function retryButton(label: string): HTMLButtonElement {
    const btn = h('button', { type: 'button', class: 'export-btn export-btn--primary', 'data-testid': 'export-retry', text: label });
    btn.addEventListener('click', () => { void start(); });
    return btn;
  }

  function render(): void {
    const state = store.get();
    const children: (Node | null)[] = [h('div', { class: 'export-heading' }, h('span', { class: 'step-medal', text: '4' }), h('h2', { text: 'Экспорт' }))];
    const ready = Boolean(state.route && state.enrichment);
    const format = state.settings.format;
    const size = DESIGN_SIZE[format];
    if (ui.kind === 'idle' || ui.kind === 'cancelled') children.push(h('div', { class: 'export-specs', 'data-testid': 'export-specs' },
      h('span', { text: `${support?.container === 'webm' ? 'WebM' : 'MP4'} · 1080p · ${FPS} fps` }),
      h('span', { text: `${state.settings.durationSec} с · ≈ ${formatFileSize(EXPORT_BITRATE * state.settings.durationSec / 8)}` }),
      h('small', { text: 'Оценка размера по битрейту; итог зависит от кадра.' }),
    ));

    if (support && !support.supported) {
      children.push(h('div', { class: 'export-notice export-notice--error', 'data-testid': 'export-unsupported' }, h('div', { text: UNSUPPORTED_MESSAGE }), h('div', { class: 'export-notice__sub', text: 'Просмотр ролика при этом работает.' })));
    }

    if (ui.kind === 'exporting') {
      const cancel = h('button', { type: 'button', class: 'export-btn export-btn--ghost', 'data-testid': 'export-cancel', text: 'Отменить' });
      cancel.addEventListener('click', () => controller?.abort());
      children.push(
        h('div', { class: 'export-progress', 'data-testid': 'export-progress', 'data-stage': ui.progress.stage },
          h('div', { class: 'export-progress__title', text: 'Собираю ролик…' }),
          stageList, bar, progressText, tabNote,
          h('p', { class: 'export-hint', text: 'Не закрывайте и не сворачивайте вкладку: если закрыть страницу, файл не сохранится.' }),
          cancel,
        ),
      );
      renderProgress();
    } else {
      const unsupported = support !== null && !support.supported;
      const showRetry = ui.kind === 'error' && ui.view.retryLabel !== null;
      const exportButton = (label: string, primary: boolean): HTMLButtonElement => {
        const btn = h('button', { type: 'button', class: `export-btn ${primary ? 'export-btn--primary' : 'export-btn--ghost'}`, 'data-testid': 'export', text: label });
        btn.disabled = !ready || unsupported || support === null;
        btn.addEventListener('click', () => { void start(); });
        return btn;
      };
      if (!showRetry && ui.kind !== 'done') {
        const hint = !ready ? 'Сначала загрузите маршрут.' : `${size.width}×${size.height} · Не сворачивайте вкладку во время экспорта.`;
        children.push(exportButton('Экспортировать ролик', true), h('p', { class: 'export-hint', text: hint }));
      }

      if (ui.kind === 'cancelled') {
        children.push(h('div', { class: 'export-notice export-notice--info', 'data-testid': 'export-cancelled', text: 'Экспорт отменён.' }));
      } else if (ui.kind === 'error') {
        const { view } = ui;
        children.push(
          h('div', { class: 'export-notice export-notice--error', 'data-testid': 'export-error', 'data-kind': view.kind ?? 'unknown', role: 'alert' },
            h('div', { text: view.message }),
            view.retryLabel ? retryButton(view.retryLabel) : null,
          ),
        );
      } else if (ui.kind === 'done') {
        // в липкой полосе — итог строкой и два действия; сам ролик — над полосой, вне её (showResult)
        const { result, url } = ui;
        const warned = result.stage === 'done-with-warnings';
        // с предупреждением главное — повтор, файл с неполной картой скачивается вторым действием
        const dl = h('a', { class: `export-btn ${warned ? 'export-btn--ghost' : 'export-btn--primary'}`, 'data-testid': 'download', href: url, download: result.fileName, text: 'Скачать' });
        children.push(
          h('div', {
            class: warned ? 'export-done export-done--warn' : 'export-done',
            'data-testid': warned ? 'export-done-warning' : 'export-done',
            'data-file-name': result.fileName, 'data-file-size': String(result.blob.size),
            'data-incomplete-frames': String(result.incompleteFrames),
          },
            h('div', { class: 'export-done__title', text: warned ? warningText(result.incompleteFrames) : 'Ролик готов' }),
            warned ? h('div', { class: 'export-hint', text: 'Проверьте интернет и повторите экспорт: на этих кадрах часть карты может быть пустой.' }) : null,
            h('div', { class: 'export-done__meta', text: `${result.fileName} · ${formatFileSize(result.blob.size)}` }),
            h('div', { class: 'export-done__actions' },
              warned ? exportButton('Повторить экспорт', true) : dl,
              warned ? dl : exportButton('Экспортировать ещё раз', false)),
          ),
        );
      }
    }
    root.replaceChildren(...children.filter((c): c is Node => c !== null));
    showResult(ui.kind === 'done' ? { url: ui.url, fileName: ui.result.fileName } : null);
    // ход, итог и ошибка экспорта должны быть на виду, даже если колонка или страница прокручены
    if (ui.kind !== 'idle') root.scrollIntoView?.({ block: 'nearest' });
  }

  // перерисовываем только при изменениях, видимых панели (иначе готовое видео перезапускалось бы от любого действия в настройках)
  const panelKey = (s: AppState) => `${Boolean(s.route && s.enrichment)}|${s.settings.format}|${s.settings.durationSec}`;
  store.subscribe((state, prev) => {
    if (ui.kind === 'exporting') return;
    if (state.settings.format !== prev.settings.format) void refreshSupport(state);
    if (panelKey(state) !== panelKey(prev)) render();
  });
  render();
  void refreshSupport(store.get());
  return root;
}

/** Подключение панели в контейнер шага 3 (`#export-slot`). */
export function mountExportPanel(store: Store): void {
  const slot = document.getElementById('export-slot');
  if (!slot) return;
  slot.replaceChildren(createExportPanel(store));
}

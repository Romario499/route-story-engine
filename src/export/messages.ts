// Тексты панели экспорта, не зависящие от DOM: этапы, предупреждение о неполной карте, сообщения об ошибках.
import { ruPlural } from '../i18n';
import { ExportError, type ExportFailureKind } from './errors';
import type { ExportProgress, ExportStage } from './index';
import { formatEta } from './util';

export const STAGE_LABELS: Record<ExportStage, string> = { prepare: 'Подготовка', frames: 'Кадры', finalize: 'Сборка файла' };

export interface ProgressView { stage: ExportStage; percent: number; text: string }

/** Что показать в панели: этап, процент полосы и подпись. «Готово» здесь не бывает — оно приходит только с результатом. */
export function describeProgress(p: ExportProgress): ProgressView {
  if (p.stage === 'prepare') return { stage: 'prepare', percent: 0, text: `${STAGE_LABELS.prepare}…` };
  if (p.stage === 'finalize') return { stage: 'finalize', percent: 100, text: `${STAGE_LABELS.finalize}…` };
  const percent = p.total > 0 ? Math.max(0, Math.min(100, Math.floor((p.frame / p.total) * 100))) : 0;
  const eta = p.etaSec !== null ? `осталось ${formatEta(p.etaSec)}` : 'считаю время…';
  return { stage: 'frames', percent, text: `${STAGE_LABELS.frames} ${p.frame} из ${p.total} · ${percent}% · ${eta}` };
}

/** «Готово с предупреждением: N кадров с недогруженной картой». */
export function warningText(incompleteFrames: number): string {
  return `Готово с предупреждением: ${incompleteFrames} ${ruPlural(incompleteFrames, ['кадр', 'кадра', 'кадров'])} с недогруженной картой`;
}

export interface ErrorView {
  kind: ExportFailureKind | null;
  message: string;
  /** Подпись кнопки повтора; null — повтор не поможет (браузер без WebCodecs). */
  retryLabel: string | null;
}

export function exportErrorView(e: unknown): ErrorView {
  if (e instanceof ExportError) {
    // сообщения ExportError уже готовы для пользователя (в том числе текст FontLoadError)
    if (e.kind === 'font') return { kind: 'font', message: e.message, retryLabel: 'Повторить' };
    if (e.kind === 'unsupported') return { kind: 'unsupported', message: e.message, retryLabel: null };
    return { kind: e.kind, message: e.message, retryLabel: 'Повторить экспорт' };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { kind: null, message: `Не удалось собрать ролик: ${msg}. Попробуйте ещё раз; если повторяется — перезагрузите страницу.`, retryLabel: 'Повторить экспорт' };
}

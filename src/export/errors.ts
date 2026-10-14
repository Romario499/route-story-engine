// Типизированные сбои экспорта: панель по `kind` выбирает текст и действие, тесты — проверяют причину.

/**
 * busy — экспорт уже идёт; font — не загрузился шрифт; webgl — карта потеряла графический контекст;
 * codec — энкодер/сборка файла упали; cancelled — отмена пользователем; unsupported — нет WebCodecs/кодека.
 */
export type ExportFailureKind = 'busy' | 'font' | 'webgl' | 'codec' | 'cancelled' | 'unsupported' | 'tiles';

export class ExportError extends Error {
  readonly kind: ExportFailureKind;
  constructor(kind: ExportFailureKind, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExportError';
    this.kind = kind;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export function isExportError(e: unknown, kind?: ExportFailureKind): e is ExportError {
  return e instanceof ExportError && (kind === undefined || e.kind === kind);
}

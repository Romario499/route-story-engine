// Строгая загрузка шрифтов ролика. Обязательный шрифт не пришёл — это ошибка, а не тихая подмена
// системным: превью покажет пометку, экспорт не стартует (панель — таск 14), повтор возможен.
// Файлы: Manrope — локально (src/assets/fonts/fonts.css), PT Serif и JetBrains Mono — из @fontsource (src/main.ts).

/** CSS-имена гарнитур ролика. */
export const FONT_FAMILIES = { manrope: 'Manrope', serif: 'PT Serif', mono: 'JetBrains Mono' } as const;

/** Обязательный шрифт не загрузился. `family` — CSS-имя гарнитуры; `message` — готовый текст для пользователя. */
export class FontLoadError extends Error {
  readonly family: string;
  constructor(family: string, cause?: unknown) {
    super(`Не загрузился шрифт ${family} — проверьте соединение и нажмите «Повторить»`);
    this.name = 'FontLoadError';
    this.family = family;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/** Образец текста с кириллицей и латиницей: по нему браузер выбирает нужные подмножества файла. */
const FONT_SAMPLE = 'AaBb Ёё Жж Яя 0123456789 км';

/** Обязательные начертания: вес → гарнитура. Каждое проверяется `document.fonts.check`. */
const REQUIRED: { family: string; weights: number[] }[] = [
  { family: FONT_FAMILIES.manrope, weights: [500, 600, 700, 800] },
  { family: FONT_FAMILIES.serif, weights: [400, 700] },
  { family: FONT_FAMILIES.mono, weights: [500] },
];

/**
 * Переходное: стили «Неон»/«Атлас» и UI пока рисуют Unbounded, Inter и JetBrains Mono 700 (таски 09 и 12 уберут).
 * Их ждём, чтобы первый кадр не ушёл запасным шрифтом, но отказ не считаем ошибкой, как раньше.
 */
const LEGACY_SPECS = [
  "600 24px 'Unbounded'", "700 24px 'Unbounded'", "700 24px 'JetBrains Mono'",
  "400 24px 'Inter'", "500 24px 'Inter'", "600 24px 'Inter'", "700 24px 'Inter'",
];

/** Зависший `document.fonts.load` не должен вешать экспорт: по истечении — отказ с «Повторить». */
export const FONT_LOAD_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, onTimeout: () => Error | null): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = onTimeout();
      if (err) reject(err); else resolve(undefined);
    }, FONT_LOAD_TIMEOUT_MS);
    work.then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
  });
}

let pending: Promise<void> | null = null;
let ready = false;
let needsReset = false; // прошлая попытка упала: отказавшие FontFace не перезагружаются сами

/**
 * Браузер не повторяет загрузку у FontFace в состоянии «ошибка» — даже если файл уже доступен.
 * Поэтому перед повтором пересоздаём таблицы стилей с @font-face: новые правила дают новые FontFace.
 */
async function recreateFontStyles(): Promise<void> {
  if (typeof document.styleSheets === 'undefined' || typeof CSSFontFaceRule === 'undefined') return;
  const waits: Promise<void>[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const owner = sheet.ownerNode;
    if (!owner || !owner.parentNode) continue;
    let hasFonts = false;
    try {
      hasFonts = Array.from(sheet.cssRules).some((r) => r instanceof CSSFontFaceRule || r instanceof CSSImportRule);
    } catch { continue; } // чужая таблица без доступа к правилам
    if (!hasFonts) continue;
    const copy = owner.cloneNode(true) as HTMLLinkElement | HTMLStyleElement;
    const loaded = new Promise<void>((resolve) => {
      if (copy instanceof HTMLLinkElement) {
        copy.addEventListener('load', () => resolve(), { once: true });
        copy.addEventListener('error', () => resolve(), { once: true });
        setTimeout(resolve, 10_000);
      } else resolve();
    });
    owner.parentNode.insertBefore(copy, owner.nextSibling);
    waits.push(loaded.then(() => owner.remove()));
  }
  await Promise.all(waits);
}

async function loadRequired(family: string, weight: number): Promise<void> {
  const spec = `${weight} 24px '${family}'`;
  let faces: unknown[];
  try {
    faces = await document.fonts.load(spec, FONT_SAMPLE);
  } catch (e) {
    throw new FontLoadError(family, e);
  }
  // пустой список — гарнитура вообще не объявлена (@font-face нет): остался бы системный шрифт
  if (!Array.isArray(faces) || faces.length === 0 || !document.fonts.check(spec, FONT_SAMPLE)) throw new FontLoadError(family);
}

async function loadAll(): Promise<void> {
  if (needsReset) { needsReset = false; await recreateFontStyles(); }
  await Promise.all([
    ...REQUIRED.flatMap(({ family, weights }) => weights.map((w) => withTimeout(loadRequired(family, w), () => new FontLoadError(family)))),
    ...LEGACY_SPECS.map((spec) => withTimeout(Promise.resolve(document.fonts.load(spec, FONT_SAMPLE)), () => null).catch(() => undefined)),
  ]);
  // готовность — не обязательное условие (обязательное проверено выше), но и не повод зависнуть
  await withTimeout(Promise.resolve(document.fonts.ready), () => null).catch(() => undefined);
}

/**
 * Дождаться обязательных шрифтов (Manrope 500–800, PT Serif 400/700, JetBrains Mono 500; латиница и кириллица).
 * Успех кэшируется. Неудача — reject `FontLoadError` и сброс кэша: следующий вызов пробует заново.
 */
export function ensureFonts(): Promise<void> {
  if (!pending) {
    const attempt: Promise<void> = loadAll().then(
      () => { if (pending === attempt) ready = true; },
      (e: unknown) => {
        if (pending === attempt) { pending = null; ready = false; needsReset = true; }
        throw e instanceof FontLoadError ? e : new FontLoadError(FONT_FAMILIES.manrope, e);
      },
    );
    pending = attempt;
  }
  return pending;
}

/** Шрифты уже загружены успешно (синхронно, без запроса). */
export function fontsReady(): boolean {
  return ready;
}

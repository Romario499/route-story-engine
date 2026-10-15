// Оформление кадра: интро, плашка страны или событийная подпись (одна за раз), показатели, профиль высот,
// прогресс, итоги. Рисуется на 2D-слое в дизайн-пикселях (1080×1920 / 1920×1080) поверх карты и трека —
// одним и тем же кодом в превью и в экспорте. Все тексты — через src/i18n/.
//
// Всё в кадре — функция от `frame` (в том числе `frame.t`, `countryChange`, `placeChange`) и данных: никаких
// состояний «с прошлого кадра» на холсте, поэтому кадр после перемотки совпадает с кадром последовательного прохода.
// Размеры шрифтов — из `StyleDef.type`, прямоугольники — из `layout.ts`, цвета оформления — здесь, ключом по styleId.
import {
  beatTitle, chapterCaption, countryName, sourceLabel, formatAltitude, formatDate, formatDateRange, formatDistance, formatNumber,
  attributionText, formatSpeed, placeName, t, transportKicker, transportTitle,
} from '../i18n';
import { ACTS, factsAt, isWaypointRoute, journeyFacts } from '../story';
import { overviewCountries, overviewLabels, type OverviewLabels } from '../story/legs';
import { matchChapters } from '../story/chapters';
import {
  type ActiveCard, type Beat, type Chapter, type Country, type Enrichment, type Format, type FrameState, type InfoKey,
  MAP_VIEWPORT, type Lang, type Place, type Route, type StorySettings, type StyleId,
} from '../types';
import { drawIcon, getFlag, type IconKind } from './assets';
import { FONT_FAMILIES } from './fonts';
import { chapterCaptionRect, layoutFor, type Layout, type Rect } from './layout';
import { chapterToneFor, fontStack, STYLES, type StyleDef } from './styles';

export interface OverlayData {
  route: Route;
  enrichment: Enrichment | null;
  settings: StorySettings;
  style: StyleDef;
  /**
   * Реконструкция по афише, а не запись GPS (`RouteSource.reconstruction`): день, дата и скорость — расчётные и помечаются «расчётно».
   * Флаг приходит явно, а не угадывается по подписи автора: стёртая подпись не должна убирать пометку.
   */
  reconstruction: boolean;
}

type Ctx = CanvasRenderingContext2D;

// ───────────────────────── тексты: заголовок, автор, подписи битов ─────────────────────────

const NBSP = ' ';
const CYRILLIC = /[Ѐ-ӿ]/;

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/** Кириллица → латиница: последняя защита, чтобы в EN-ролике не осталось русских букв. */
function transliterate(text: string): string {
  let out = '';
  for (const ch of text) {
    const low = ch.toLowerCase();
    const tr = TRANSLIT[low];
    if (tr === undefined) { out += ch; continue; }
    out += low !== ch && tr ? tr[0].toUpperCase() + tr.slice(1) : tr;
  }
  return out;
}

/** Короткие названия для крупных надписей: в заголовке нужен «Китай», а не «Китайская Народная Республика». */
const SHORT_NAMES: Record<string, { ru: string; en: string }> = {
  CN: { ru: 'Китай', en: 'China' },
  KR: { ru: 'Южная Корея', en: 'South Korea' },
  HT: { ru: 'Гаити', en: 'Haiti' },
  XK: { ru: 'Косово', en: 'Kosovo' },
  AE: { ru: 'ОАЭ', en: 'UAE' },
  US: { ru: 'США', en: 'USA' },
  CD: { ru: 'ДР Конго', en: 'DR Congo' },
  XX: { ru: 'Северный Кипр', en: 'Northern Cyprus' },
};

/** Название страны для ролика: короткое, если для неё есть сокращение. */
export function shortCountryName(lang: Lang, c: Country): string {
  return SHORT_NAMES[c.iso2]?.[lang] ?? countryName(lang, c);
}

/** Имя маршрута из файла как заголовок; у маршрута по меткам это имя документа KML («Organic Maps Bookmarks and Tracks»), а не название поездки. */
const ownName = (route: Route | null): string => (route && !isWaypointRoute(route) ? route.name?.trim() ?? '' : '');

/**
 * Заголовок ролика: свой; иначе «<страна старта> → <страна финиша>»; поездка по одной стране — имя трека из файла,
 * а без него — страна; нет стран — имя из файла, иначе заглушка.
 */
export function resolveTitle(lang: Lang, custom: string, route: Route | null, enrichment: Enrichment | null): string {
  const own = custom.trim();
  if (own) return own;
  if (route && isWaypointRoute(route) && !route.waypointOrderConfirmed) {
    return overviewCountries(route, enrichment).map(c => shortCountryName(lang, c)).join(' · ') || t(lang, 'note.geographicOverview');
  }
  if (route && isWaypointRoute(route)) {
    // Крайние подтверждённые метки, без перестановки и интерпретации дат закладок.
    const runs = enrichment?.countryRuns ?? [];
    const from = runs.find((r) => r.fromIdx === 0)?.country;
    const to = runs.find((r) => r.toIdx === route.points.length - 1)?.country;
    if (!from || !to) return t(lang, 'intro.untitled');
    const a = shortCountryName(lang, from), b = shortCountryName(lang, to);
    return a === b ? a : `${a} → ${b}`;
  }
  const visited = (enrichment?.countryRuns ?? []).map((r) => r.country).filter((c): c is Country => c !== null);
  if (visited.length) {
    const from = shortCountryName(lang, visited[0]);
    const to = shortCountryName(lang, visited[visited.length - 1]);
    if (from !== to) return `${from} → ${to}`;
    return ownName(route) || from;
  }
  const named = ownName(route);
  return named || t(lang, 'intro.untitled');
}

/** Подпись автора на языке ролика: стандартная подпись примера («реконструкция маршрута») переводится. */
export function localizeAuthor(lang: Lang, author: string): string {
  const text = author.trim();
  if (lang === 'en') return text.replace(/реконструкция маршрута/gi, t('en', 'note.reconstruction'));
  return text.replace(/route reconstruction/gi, t('ru', 'note.reconstruction'));
}

const WAYPOINT_PLACE_KM = 5;

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export interface BeatCaption { kicker?: string; title: string }

/** Текст карточки бита: заголовок-«кикер» и крупная строка. Только на языке ролика. */
export function beatCaption(lang: Lang, beat: Beat, route: Route, recording = false): BeatCaption {
  switch (beat.kind) {
    case 'start':
    case 'finish': {
      const kicker = t(lang, beat.kind === 'start' ? 'beat.start' : recording && !isWaypointRoute(route) ? 'film.lastPoint' : 'beat.finish');
      const name = beat.place ? placeName(lang, beat.place) : '';
      if (!name) return { title: kicker };
      // маршрут по меткам: город в радиусе от огрублённой метки — только «рядом», не место старта/финиша (G90)
      if (isWaypointRoute(route)) return { kicker: t(lang, beat.kind === 'start' ? 'beat.startNear' : 'beat.finishNear'), title: name };
      return { kicker, title: recording && beat.kind === 'finish' ? `${t(lang, 'label.city')}: ${name}` : name };
    }
    case 'country':
      return { kicker: t(lang, 'label.country'), title: beat.country ? shortCountryName(lang, beat.country) : beatTitle(lang, beat) };
    case 'peak':
      return { kicker: t(lang, 'beat.peak'), title: beat.ele !== undefined ? formatAltitude(lang, beat.ele) : t(lang, 'beat.peak') };
    case 'waypoint': {
      const at = route.points[Math.min(route.points.length - 1, Math.max(0, beat.idx))];
      const near = beat.place && at
        && haversineKm(at.lat, at.lon, beat.place.lat, beat.place.lon) <= WAYPOINT_PLACE_KM;
      if (near && beat.place) return { title: placeName(lang, beat.place) };
      const label = beat.label?.trim() ?? '';
      if (lang === 'en' && CYRILLIC.test(label)) return { title: transliterate(label) };
      if (label) return { title: label };
      return { title: beat.place ? placeName(lang, beat.place) : '•' };
    }
  }
}

// ───────────────────────── подбор размера и перенос заголовка ─────────────────────────

/** Межстрочный интервал заголовка по умолчанию (множитель кегля); у стилей свой — SKINS[id].leading. */
const TITLE_LINE_HEIGHT = 1.1;
/** Ниже этого кегля заголовок не ужимаем даже в аварийном режиме (строки всё равно влезут за счёт переноса). */
const TITLE_RESCUE_FLOOR = 24;

export interface TitleLayout {
  size: number;
  lines: string[];
  /** Заголовок поместился в пределы по строкам и высоте при кегле не ниже нижнего порога роли. */
  fits: boolean;
}

interface Token { text: string; /** без пробела перед ним (продолжение после дефиса) */ glue: boolean }

/** Слова → токены; breakHyphens — разрешить перенос после дефиса («Санкт-Петербург»). */
function tokenize(words: string[], breakHyphens: boolean): Token[] {
  if (!breakHyphens) return words.map((text) => ({ text, glue: false }));
  const out: Token[] = [];
  for (const w of words) {
    const parts = w.match(/[^-]+-?|-/g) ?? [w];
    parts.forEach((p, i) => out.push({ text: p, glue: i > 0 }));
  }
  return out;
}

/**
 * Размер и строки заголовка: самый крупный кегль в [minSize, maxSize], при котором текст помещается в maxW × maxH
 * не более чем в maxLines строк. Переносит по словам (если иначе никак — ещё и после дефиса), балансирует строки
 * (узкая — не «сирота»), стрелка «→» остаётся с правым словом. measure(строка, кегль) → ширина. Не помещается
 * при кегле не ниже minSize — `fits: false`, а текст всё равно целиком влезает (кегль уменьшается дальше):
 * молча обрезать заголовок нельзя, предупреждение показывает UI.
 */
export function layoutTitle(
  text: string, measure: (s: string, size: number) => number, maxW: number, maxLines: number,
  maxSize: number, minSize: number, maxH = Number.POSITIVE_INFINITY, leading = TITLE_LINE_HEIGHT,
): TitleLayout {
  const prepared = text.replace(/[ \t\r\n]+/g, ' ').replace(/ ?→ ?/g, ` →${NBSP}`).trim();
  const words = prepared.split(' ').filter(Boolean);
  if (!words.length) return { size: minSize, lines: [''], fits: true };

  const sizesFrom = (from: number, to: number, step: number): number[] => {
    const list: number[] = [];
    for (let s = from; s > to; s = Math.floor(s * step) || to) list.push(s);
    list.push(to);
    return list;
  };

  /** Строки при данном кегле или null, если не влезает в maxLines × maxH. */
  const tryWrap = (tokens: Token[], size: number): string[] | null => {
    const widths = tokens.map((tk) => measure(tk.text, size));
    const space = measure(' ', size);
    const fitsHeight = (n: number) => n * size * leading <= maxH;
    const join = (from: number, to: number) => tokens.slice(from, to).map((tk, i) => (i > 0 && !tk.glue ? ' ' : '') + tk.text).join('');
    const greedy = (limit: number): string[] => {
      const lines: string[] = [];
      let start = 0, curW = 0;
      tokens.forEach((tk, i) => {
        const add = widths[i] + (i > start && !tk.glue ? space : 0);
        if (i > start && curW + add > limit) { lines.push(join(start, i)); start = i; curW = widths[i]; } else { curW += add; }
      });
      lines.push(join(start, tokens.length));
      return lines;
    };
    const total = widths.reduce((a, b) => a + b, 0) + tokens.reduce((n, tk, i) => n + (i > 0 && !tk.glue ? space : 0), 0);
    if (total <= maxW && fitsHeight(1)) return [join(0, tokens.length)];
    if (maxLines < 2 || Math.max(...widths) > maxW || greedy(maxW).length > maxLines) return null;
    // самая узкая ширина, при которой строк не больше предела — строки получаются ровными
    let lo = Math.max(...widths), hi = maxW;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (greedy(mid).length <= maxLines) hi = mid; else lo = mid;
    }
    const lines = greedy(hi + 0.01);
    return fitsHeight(lines.length) ? lines : null;
  };

  const variants = [tokenize(words, false)];
  if (words.some((w) => w.includes('-') && w.length > 1)) variants.push(tokenize(words, true));
  for (const tokens of variants) {
    for (const size of sizesFrom(maxSize, minSize, 0.96)) {
      const lines = tryWrap(tokens, size);
      if (lines) return { size, lines, fits: true };
    }
  }
  // не помещается при кегле не ниже порога: ужимаем дальше, чтобы текст остался виден целиком
  for (const tokens of variants.slice().reverse()) {
    for (const size of sizesFrom(Math.floor(minSize * 0.94), TITLE_RESCUE_FLOOR, 0.94)) {
      const lines = tryWrap(tokens, size);
      if (lines) return { size, lines, fits: false };
    }
  }
  // совсем аварийно (одно сверхдлинное слово): кегль по ширине слова
  const widest = Math.max(...words.map((w) => measure(w, minSize)));
  const size = widest > maxW ? Math.max(12, Math.floor((minSize * maxW) / widest)) : minSize;
  const tokens = tokenize(words, false);
  const space = measure(' ', size);
  const lines: string[] = [];
  let cur = '', curW = 0;
  for (const tk of tokens) {
    const w = measure(tk.text, size);
    if (cur && curW + space + w > maxW) { lines.push(cur); cur = tk.text; curW = w; } else { cur = cur ? `${cur} ${tk.text}` : tk.text; curW = cur === tk.text ? w : curW + space + w; }
  }
  if (cur) lines.push(cur);
  return { size, lines, fits: false };
}

// ───────────────────────── оформление по стилям ─────────────────────────

/** Цвета и характер оформления ролика по стилям. Цвета «Экспедиции» — тона V3: navy-подложка, золото, редкий cyan. */
interface Skin {
  /** Основной текст, вторичный текст, акцент (иконки, прогресс, надзаголовки), редкий второй акцент. */
  ink: string; muted: string; accent: string; accent2: string;
  /** Локальная подложка под текстом: цвет `r,g,b` и сила. */
  scrim: string; scrimAlpha: number;
  /** Тонкие разделители. */
  rule: string;
  /** Мягкая тёмная тень под текстом для читаемости на пёстрой карте (не свечение); null — без неё. */
  shadow: string | null;
  /** Иконки у показателей и подписей (у «Атласа» — нет: чистая редакционная сетка). */
  icons: boolean;
  /** Межстрочный интервал заголовка. */
  leading: number;
  /** Разделители между рядами показателей (у «Экспедиции» — только вертикальный между колонками). */
  rowRules: boolean;
}

const SKINS: Record<StyleId, Skin> = {
  epic: {
    ink: '#F4F7FA', muted: '#A8BACB', accent: '#FFBC4D', accent2: '#70CFE6',
    scrim: '8,15,26', scrimAlpha: 0.74, rule: 'rgba(244,247,250,0.22)', shadow: 'rgba(4,9,16,0.5)',
    icons: true, leading: 0.96, rowRules: false,
  },
  neon: {
    ink: '#EAF4F3', muted: '#9FB3BD', accent: '#67D9DB', accent2: '#D99DB8',
    scrim: '8,12,22', scrimAlpha: 0.72, rule: 'rgba(103,217,219,0.3)', shadow: 'rgba(2,6,12,0.5)',
    icons: true, leading: 0.98, rowRules: true,
  },
  atlas: {
    ink: '#1F332D', muted: '#4D6358', accent: '#B34D37', accent2: '#B34D37',
    scrim: '244,240,230', scrimAlpha: 0.88, rule: 'rgba(31,51,45,0.42)', shadow: null,
    icons: false, leading: 0.93, rowRules: true,
  },
};

// ───────────────────────── мелкие помощники рисования ─────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const v = clamp01(x); return v * v * (3 - 2 * v); };
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;

/** '#rrggbb' + прозрачность → rgba(). Прочие цвета возвращаются как есть. */
function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Масштаб холста: тень и фильтры задаются в пикселях холста, а не в дизайн-пикселях. */
function canvasScale(ctx: Ctx): number {
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  return m && Number.isFinite(m.a) && m.a > 0 ? m.a : 1;
}

function setTracking(ctx: Ctx | OffscreenCanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = `${px}px`;
}

function roundPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

type RoleName = keyof StyleDef['type'];

/** Рабочая среда одного вызова drawOverlay. */
interface Env {
  overview?: OverviewLabels;
  ctx: Ctx;
  frame: FrameState;
  data: OverlayData;
  layout: Layout;
  style: StyleDef;
  skin: Skin;
  lang: Lang;
  /** Масштаб холста (для теней). */
  k: number;
  /** Реконструкция по афише: даты, дни и скорость — расчётные, их подписи помечаются (история 80). */
  reconstruction: boolean;
}

const fontCss = (family: string, weight: number, size: number): string => `${weight} ${size}px ${fontStack(family)}`;

function roleBase(role: StyleDef['type'][RoleName]): number {
  return 'size' in role ? role.size : role.max;
}

interface TextOpts {
  role: RoleName;
  size?: number;
  color: string;
  align?: CanvasTextAlign;
  alpha?: number;
  /** Ужать кегль (до minSize), затем обрезать многоточием, если строка шире. */
  maxW?: number;
  minSize?: number;
  weight?: number;
  /** Разрядка, доля em; по умолчанию — из роли. */
  tracking?: number;
  shadow?: boolean;
  /**
   * Цифры в ячейках одной ширины («табличные»): число не «дышит» при счёте. 'left' — x это левый край,
   * 'right' — правый (разряды растут влево, единицы справа стоят на месте).
   */
  tabular?: 'left' | 'right';
}

/** Одна строка текста по роли шрифта стиля. Возвращает ширину нарисованного. */
function text(env: Env, str: string, x: number, y: number, o: TextOpts): number {
  const { ctx, style, skin, k } = env;
  const role = style.type[o.role];
  let size = o.size ?? roleBase(role);
  const weight = o.weight ?? role.weight;
  const tracking = o.tracking ?? ('tracking' in role ? role.tracking : 0);
  const content = o.role === 'kicker' ? str.toLocaleUpperCase(env.lang) : str;
  ctx.save();
  const apply = () => { ctx.font = fontCss(role.family, weight, size); setTracking(ctx, o.tabular ? 0 : tracking * size); };
  apply();
  const measure = () => (o.tabular ? tabularWidth(ctx, content) : ctx.measureText(content).width);
  let w = measure();
  if (o.maxW && w > o.maxW && w > 0) {
    size = Math.max(o.minSize ?? size * 0.6, Math.floor((size * o.maxW) / w));
    apply();
    w = measure();
  }
  let out = content;
  if (o.maxW && w > o.maxW + 0.5 && !o.tabular) { out = ellipsize(ctx, content, o.maxW); w = ctx.measureText(out).width; }
  ctx.fillStyle = o.color;
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.textBaseline = 'alphabetic';
  if (skin.shadow && o.shadow !== false) {
    ctx.shadowColor = skin.shadow;
    ctx.shadowBlur = 14 * k;
    ctx.shadowOffsetY = 2 * k;
  }
  if (o.tabular) {
    ctx.textAlign = 'left';
    fillTabular(ctx, out, o.tabular === 'right' ? x - w : x, y);
  } else {
    ctx.textAlign = o.align ?? 'left';
    ctx.fillText(out, x, y);
  }
  ctx.restore();
  return w;
}

/** Обрезать строку многоточием под ширину (на случай очень длинных названий после ужатия кегля). */
function ellipsize(ctx: Ctx | OffscreenCanvasRenderingContext2D, str: string, maxW: number): string {
  if (ctx.measureText(str).width <= maxW + 0.5) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** Ширина «ячейки» цифры при текущем шрифте: самая широкая из 0–9 — соседние цифры не наезжают. */
function digitCell(ctx: Ctx | OffscreenCanvasRenderingContext2D): number {
  let max = 0;
  for (const d of '0123456789') max = Math.max(max, ctx.measureText(d).width);
  return max;
}

/** Ширина строки с цифрами фиксированной ширины. */
function tabularWidth(ctx: Ctx | OffscreenCanvasRenderingContext2D, str: string): number {
  const cell = digitCell(ctx);
  let w = 0;
  for (const ch of str) w += ch >= '0' && ch <= '9' ? cell : ctx.measureText(ch).width;
  return w;
}

/** Рисует строку слева направо, каждая цифра — по центру ячейки одной ширины; возвращает ширину. */
function fillTabular(ctx: Ctx, str: string, x: number, y: number): number {
  const cell = digitCell(ctx);
  let cx = x;
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') {
      const w = ctx.measureText(ch).width;
      ctx.fillText(ch, cx + (cell - w) / 2, y);
      cx += cell;
    } else {
      ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width;
    }
  }
  return cx - x;
}

/** Ширина табличного числа заданного кегля без рисования (ctx.font выставляется здесь). */
function numberWidth(env: Env, str: string, size: number): number {
  const role = env.style.type.number;
  env.ctx.save();
  env.ctx.font = fontCss(role.family, role.weight, size);
  setTracking(env.ctx, 0);
  const w = tabularWidth(env.ctx, str);
  env.ctx.restore();
  return w;
}

function textWidth(env: Env, str: string, roleName: RoleName, size: number): number {
  const role = env.style.type[roleName];
  env.ctx.save();
  env.ctx.font = fontCss(role.family, role.weight, size);
  setTracking(env.ctx, 0);
  const w = env.ctx.measureText(str).width;
  env.ctx.restore();
  return w;
}

// стрелка «→» рисуется контуром: в шрифтах нет гарантированной стрелки (подставился бы системный шрифт)
const arrowAdvance = (size: number) => size * 0.95;

function sizeOfFont(ctx: Ctx | OffscreenCanvasRenderingContext2D): number {
  return Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '16');
}

function richWidth(ctx: Ctx | OffscreenCanvasRenderingContext2D, str: string): number {
  const size = sizeOfFont(ctx);
  const parts = str.split('→');
  let w = 0;
  for (const p of parts) w += ctx.measureText(p).width;
  return w + (parts.length - 1) * arrowAdvance(size);
}

/** Текст со «→» слева направо от x; baseline — базовая линия. Цвет — текущий fillStyle. */
function richFill(ctx: Ctx, str: string, x: number, baseline: number): void {
  const size = sizeOfFont(ctx);
  ctx.textAlign = 'left';
  if (!str.includes('→')) { ctx.fillText(str, x, baseline); return; }
  let cx = x;
  const parts = str.split('→');
  parts.forEach((part, i) => {
    ctx.fillText(part, cx, baseline);
    cx += ctx.measureText(part).width;
    if (i < parts.length - 1) {
      const adv = arrowAdvance(size);
      const y = baseline - size * 0.36;
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = Math.max(2, size * 0.085);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(cx + adv * 0.1, y);
      ctx.lineTo(cx + adv * 0.82, y);
      ctx.moveTo(cx + adv * 0.82 - size * 0.2, y - size * 0.2);
      ctx.lineTo(cx + adv * 0.82, y);
      ctx.lineTo(cx + adv * 0.82 - size * 0.2, y + size * 0.2);
      ctx.stroke();
      ctx.restore();
      cx += adv;
    }
  });
}

// ───────────────────────── подбор заголовка: измерение и предупреждение для UI ─────────────────────────

export type Measurer = (str: string, size: number) => number;

/** Холст для измерения без кадра (в тестах Node его нет — тогда приближение по среднему размеру букв). */
let measureCtxCache: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
function measureContext(): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
  if (measureCtxCache !== undefined) return measureCtxCache;
  try {
    if (typeof OffscreenCanvas !== 'undefined') measureCtxCache = new OffscreenCanvas(8, 8).getContext('2d');
    else if (typeof document !== 'undefined') measureCtxCache = document.createElement('canvas').getContext('2d');
    else measureCtxCache = null;
  } catch { measureCtxCache = null; }
  return measureCtxCache ?? null;
}

/** Грубая ширина строки без шрифтов: доли em по классам букв (для сред без холста, в том числе юнит-тестов). */
function approxWidth(str: string, size: number, serif: boolean, trackingEm: number): number {
  const base = serif ? 0.5 : 0.56;
  let w = 0;
  for (const ch of str) {
    if (ch === '→') w += 0.95;
    else if (ch === ' ' || ch === NBSP) w += 0.27;
    else if (/[il.,:;'|!ьйtfjI]/.test(ch)) w += base * 0.55;
    else if (/[mwшщжюыМШЩЖЮЫ@]/.test(ch)) w += base * 1.35;
    else if (ch !== ch.toLowerCase()) w += base * 1.2;
    else w += base;
    w += trackingEm;
  }
  return w * size;
}

function titleMeasurer(style: StyleDef): Measurer {
  const role = style.type.title;
  const ctx = measureContext();
  if (!ctx) return (str, size) => approxWidth(str, size, role.family === FONT_FAMILIES.serif, role.tracking);
  return (str, size) => {
    ctx.font = fontCss(role.family, role.weight, size);
    setTracking(ctx, role.tracking * size);
    return richWidth(ctx, str);
  };
}

/** Заголовок в раскладке стиля и формата. measure — настоящий (с ctx кадра) или по умолчанию — измерительный холст. */
function fitTitleIn(title: string, format: Format, styleId: StyleId, measure: Measurer): TitleLayout {
  const layout = layoutFor(format, styleId);
  const role = STYLES[styleId].type.title;
  return layoutTitle(title, measure, layout.title.w, layout.titleMaxLines, role.max, role.min, layout.title.h, SKINS[styleId].leading);
}

/** Раскладка заголовка в кадре стиля и формата (кегль, строки, влез ли) — по тому же измерению, что и предупреждение в UI. */
export function fitTitle(title: string, format: Format, styleId: StyleId, measure?: Measurer): TitleLayout {
  return fitTitleIn(title, format, styleId, measure ?? titleMeasurer(STYLES[styleId]));
}

/**
 * Помещается ли заголовок в кадр при нижнем пороге читаемости роли (история 67): ≤ 3 строк в 9:16, ≤ 2 в 16:9.
 * `maxChars` — сколько символов с начала строки ещё помещается (для текста «сократите до N символов»).
 * Для UI: на шаге «Стиль» по этому показывается предупреждение; экспорт заголовок не режет.
 */
export function titleFits(_lang: Lang, title: string, format: Format, styleId: StyleId): { fits: boolean; maxChars: number } {
  const text = title.trim();
  const measure = titleMeasurer(STYLES[styleId]);
  const fitsAt = (s: string) => !s || fitTitleIn(s, format, styleId, measure).fits;
  if (fitsAt(text)) return { fits: true, maxChars: text.length };
  let lo = 0, hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fitsAt(text.slice(0, mid).trimEnd())) lo = mid; else hi = mid - 1;
  }
  return { fits: false, maxChars: lo };
}

// ───────────────────────── подложки под текстом ─────────────────────────

/** Мягкий градиент от края: вертикальная полоса по всей ширине, плотная у `from` и прозрачная у противоположного края. */
function scrimBand(env: Env, y0: number, y1: number, strength: number, plotAt: 'top' | 'bottom'): void {
  const a = env.skin.scrimAlpha * strength;
  if (a <= 0.005 || y1 <= y0) return;
  const { ctx, layout, skin } = env;
  const g = ctx.createLinearGradient(0, plotAt === 'top' ? y0 : y1, 0, plotAt === 'top' ? y1 : y0);
  g.addColorStop(0, `rgba(${skin.scrim},${a})`);
  g.addColorStop(0.55, `rgba(${skin.scrim},${a * 0.55})`);
  g.addColorStop(1, `rgba(${skin.scrim},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, layout.width, y1 - y0);
}

/** Мягкое пятно (эллипс с плавным краем) под блоком текста. */
function scrimBlob(env: Env, cx: number, cy: number, rx: number, ry: number, strength: number): void {
  const a = env.skin.scrimAlpha * strength;
  if (a <= 0.005) return;
  const { ctx, skin } = env;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(${skin.scrim},${a})`);
  g.addColorStop(0.5, `rgba(${skin.scrim},${a * 0.62})`);
  g.addColorStop(1, `rgba(${skin.scrim},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
  ctx.restore();
}

// ───────────────────────── флаги ─────────────────────────

function drawFlag(env: Env, iso2: string, x: number, y: number, w: number, h: number, radius: number): void {
  const { ctx, style, skin } = env;
  const img = getFlag(iso2);
  ctx.save();
  roundPath(ctx, x, y, w, h, radius);
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x, y, w, h);
  } else {
    // флаг ещё не загружен (или такого нет): нейтральная плашка с кодом страны
    ctx.fillStyle = withAlpha(skin.accent, 0.3);
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = skin.ink;
    ctx.font = fontCss(style.type.label.family, 700, Math.round(h * 0.42));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(iso2.toUpperCase(), x + w / 2, y + h / 2);
  }
  ctx.restore();
  ctx.save();
  ctx.lineWidth = Math.max(1.2, h * 0.03);
  ctx.strokeStyle = style.id === 'atlas' ? 'rgba(31,51,45,0.5)' : 'rgba(255,255,255,0.42)';
  roundPath(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.restore();
}

// ───────────────────────── слот сверху: плашка страны или событие ─────────────────────────

const PLAQUE_SWAP_SEC = 0.6;
const PLACE_FADE_SEC = 0.35;
const PLAQUE_ROW_H = 76;

/** Анимация от `frame.t`: начало смены берётся из `frame.countryChange`, состояния на холсте нет. */
interface PlaqueView { cur: Country | null; prev: Country | null; e: number }

function plaqueView(frame: FrameState): PlaqueView {
  const cur = frame.stats.country;
  const cc = frame.countryChange;
  if (!cc) return { cur, prev: null, e: 1 };
  const e = easeOut((frame.t - cc.at) / PLAQUE_SWAP_SEC);
  return { cur: cc.to ?? cur, prev: cc.from, e };
}

function drawPlaque(env: Env, country: Country, alpha: number, dy: number): void {
  if (alpha <= 0.004) return;
  const { ctx, style, skin, layout } = env;
  const area = layout.caption;
  const atlas = style.id === 'atlas';
  const compact = env.frame.act === 'journey' && !!env.data.route.chapters?.length;
  const rowH = compact ? 44 : PLAQUE_ROW_H;
  const flagH = compact ? 28 : (atlas ? 46 : style.id === 'neon' ? 54 : 58) * layout.readability.countryScale;
  const flagW = flagH * (4 / 3);
  const nameSize = compact ? 36 : (style.id === 'epic' ? 64 : 60) * layout.readability.countryScale;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const y = area.y + dy;
  drawFlag(env, country.iso2, area.x, y + (rowH - flagH) / 2, flagW, flagH, atlas ? 4 : 9);
  text(env, shortCountryName(env.lang, country), area.x + flagW + 22, y + rowH / 2 + nameSize * 0.34, {
    role: 'title', size: nameSize, color: skin.ink, maxW: area.w - flagW - 22, minSize: 34,
  });
  ctx.restore();
}

function drawCountryPlaque(env: Env, strength: number): void {
  if (strength <= 0.004 || !env.data.settings.info.country) return;
  if (isWaypointRoute(env.data.route)) {
    if (env.overview) {
      if (env.overview.country) drawPlaque(env, env.overview.country, strength, 0);
      else if (env.overview.countries.length > 1) {
        const area = env.layout.caption;
        text(env, t(env.lang, 'overview.countries', { n: env.overview.countries.length }),
          area.x, area.y + PLAQUE_ROW_H / 2 + 60 * 0.34, {
            role: 'title', size: 60, color: env.skin.ink, maxW: area.w, minSize: 34, alpha: strength,
          });
      }
      return;
    }
    const i = Math.floor(env.frame.head);
    const e = env.data.enrichment;
    const from = e?.countryAt(i), to = e?.countryAt(Math.min(i + 1, env.data.route.points.length - 1));
    if (env.data.route.waypointOrderConfirmed && env.frame.head > i && from?.iso2 !== to?.iso2) {
      if (from && to) {
        const area = env.layout.caption;
        text(env, t(env.lang, 'waypoints.countryLeg', {
          from: shortCountryName(env.lang, from), to: shortCountryName(env.lang, to),
        }), area.x, area.y + PLAQUE_ROW_H / 2 + 60 * 0.34, {
          role: 'title', size: 60, color: env.skin.ink, maxW: area.w, minSize: 34, alpha: strength,
        });
      }
      return;
    }
    if (env.frame.stats.country) drawPlaque(env, env.frame.stats.country, strength, 0);
    return;
  }
  const v = plaqueView(env.frame);
  const rise = env.style.motion.appear === 'fade-rise' ? env.style.motion.rise : 0;
  if (v.prev && v.e < 1) drawPlaque(env, v.prev, strength * (1 - v.e), -rise * v.e);
  if (v.cur) drawPlaque(env, v.cur, strength * (v.prev ? v.e : easeOut(v.e)), rise * (1 - v.e));
}

function transportIcon(kind: NonNullable<ActiveCard['transport']>['kind']): IconKind {
  return kind === 'train' ? 'train' : kind === 'unicycle' ? 'unicycle' : 'gap';
}

function beatIcon(beat: Beat): IconKind {
  switch (beat.kind) {
    case 'start': return 'start';
    case 'finish': return 'finish';
    case 'peak': return 'peak';
    default: return 'waypoint';
  }
}

/** Переносы и границы главы общие для рисования, легенды и свободного места под выноски. */
interface ChapterGeometry {
  area: Rect;
  cap: ReturnType<typeof chapterCaption>;
  lines: { str: string; role: 'title' | 'label'; size: number; min: number; baseline: number }[];
  rect: Rect;
}
const chapterGeometryCache = new WeakMap<Chapter, Map<string, ChapterGeometry>>();
function chapterGeometryKey(env: Env): string {
  return `${env.layout.format}|${env.style.id}|${env.lang}|${env.k}|${env.frame.act === 'outro'}`;
}
function chapterGeometry(env: Env, chapter: Chapter) {
  let cache = chapterGeometryCache.get(chapter);
  if (!cache) { cache = new Map(); chapterGeometryCache.set(chapter, cache); }
  const key = chapterGeometryKey(env), hit = cache.get(key);
  if (hit) return hit;
  const area = env.frame.act === 'outro' ? { ...env.layout.caption, h: 210 }
    : chapterCaptionRect(env.layout.format, env.style.id);
  const cap = chapterCaption(env.lang, chapter);
  const lines: { str: string; role: 'title' | 'label'; size: number; min: number; baseline: number }[] = [];
  let bottom = area.y + 24;
  let baseline = area.y + 32;
  for (const part of [{ str: cap.title, role: 'title' as const, max: 44, min: 28 }, { str: cap.text, role: 'label' as const, max: 26, min: 22 }]) {
    const measure = (str: string, size: number) => textWidth(env, str, part.role, size);
    const fitted = layoutTitle(part.str, measure, area.w, 2, part.max, part.min, 90, 1.15);
    for (const line of fitted.lines) {
      baseline += fitted.size * 1.15;
      lines.push({ str: line, role: part.role, size: fitted.size, min: part.min, baseline });
      // Нижние выносные элементы букв находятся ниже базовой линии.
      const role = env.style.type[part.role];
      env.ctx.save();
      env.ctx.font = fontCss(role.family, role.weight, fitted.size);
      setTracking(env.ctx, 0);
      const descent = env.ctx.measureText(line).actualBoundingBoxDescent;
      env.ctx.restore();
      bottom = Math.max(bottom, baseline + (Number.isFinite(descent) ? descent : fitted.size * 0.25));
    }
    baseline += 6;
  }
  // Include the simultaneous country plaque in the obstacle used by geography.
  const top = env.frame.act === 'outro' ? area.y : env.layout.caption.y;
  const geometry = { area, cap, lines, rect: { ...area, y: top, h: bottom - top + 8 } };
  cache.set(key, geometry);
  return geometry;
}

function drawChapterCaption(env: Env, chapter: Chapter, alpha: number): void {
  const { ctx, skin, style } = env;
  const { area, cap, lines, rect } = chapterGeometry(env, chapter);
  ctx.save(); ctx.globalAlpha *= alpha;
  // Two layers of the existing card palette keep route icons quiet under the text.
  ctx.fillStyle = style.palette.cardBg;
  ctx.fillRect(area.x - 8, area.y - 8, area.w + 16, rect.y + rect.h - area.y + 8);
  ctx.fillRect(area.x - 8, area.y - 8, area.w + 16, rect.y + rect.h - area.y + 8);
  const tone = chapterToneFor(style.id, env.frame.chapterMood);
  const accent = tone.strength > 0.01 && style.id === 'atlas' ? `rgb(${tone.rgb.map(Math.round).join(',')})` : skin.accent;
  text(env, cap.source, area.x, area.y + 20, { role: 'secondary', size: 20, color: accent, maxW: area.w, minSize: 18 });
  for (const line of lines) {
    text(env, line.str, area.x, line.baseline, { role: line.role, size: line.size, color: skin.ink, maxW: area.w, minSize: line.min });
  }
  ctx.restore();
}

function drawEventCard(env: Env, card: ActiveCard, strength: number): void {
  if (card.chapter) { drawChapterCaption(env, card.chapter, clamp01(card.alpha) * strength); return; }
  const { ctx, layout, style, skin } = env;
  const alpha = clamp01(card.alpha) * strength;
  if (alpha <= 0.004) return;
  // смена транспорта (маршрут по меткам): значок вида передвижения, надзаголовок и название; уницикл подписан как предположение
  const cap: BeatCaption = card.transport
    ? { kicker: transportKicker(env.lang, card.transport), title: transportTitle(env.lang, card.transport) }
    : beatCaption(env.lang, card.beat, env.data.route, !!env.frame.shot);
  // источник главы заменяет надзаголовок, но не оговорку «рядом» у старта/финиша по меткам
  const nearEnd = !card.transport && !!card.beat.place && (card.beat.kind === 'start' || card.beat.kind === 'finish')
    && isWaypointRoute(env.data.route);
  // оговорка «способ неизвестен» источником главы не подменяется: честность важнее атрибуции
  const keepKicker = card.transport?.kind === 'unknown';
  if (env.frame.chapterMood && !nearEnd && !keepKicker) cap.kicker = sourceLabel(env.lang, isWaypointRoute(env.data.route) ? 'organic-maps' : 'gps');
  const a = layout.caption;
  const lead = 56;
  const isFlag = card.beat.kind === 'country' && !!card.beat.country;
  const atlas = style.id === 'atlas';
  const leadW = isFlag ? lead * (4 / 3) : skin.icons ? lead : 0;
  const tx = a.x + (atlas ? 22 : leadW + 24);
  const rise = (1 - easeOut(card.enter)) * (style.motion.appear === 'fade-rise' ? style.motion.rise : 0);
  const leaving = card.enter >= 1 && card.alpha < 1;
  const y = a.y + rise - (leaving ? (1 - card.alpha) * Math.min(12, style.motion.rise) : 0);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (atlas) {
    ctx.fillStyle = skin.accent;
    ctx.fillRect(a.x, y + 6, 4, 92);
  } else if (isFlag && card.beat.country) {
    drawFlag(env, card.beat.country.iso2, a.x, y + (96 - lead) / 2 + 4, leadW, lead, 9);
  } else if (skin.icons) {
    drawIcon(ctx, card.transport ? transportIcon(card.transport.kind) : beatIcon(card.beat), a.x + lead / 2, y + 52, lead * 0.86, skin.accent);
  }
  const maxText = a.x + a.w - tx;
  const titleSize = 60;
  if (cap.kicker) {
    text(env, cap.kicker, tx, y + 32, { role: 'kicker', color: skin.accent, maxW: maxText, minSize: 20 });
    text(env, cap.title, tx, y + 32 + 14 + titleSize * 0.78, { role: 'title', size: titleSize, color: skin.ink, maxW: maxText, minSize: 30 });
  } else {
    text(env, cap.title, tx, y + 52 + titleSize * 0.3, { role: 'title', size: titleSize, color: skin.ink, maxW: maxText, minSize: 30 });
  }
  ctx.restore();
}

/** Голова на участке-разрыве трека (переезд)? Возвращает долю участка 0..1 или null. */
function gapProgress(frame: FrameState, route: Route): number | null {
  const pts = route.points;
  const i = Math.min(pts.length - 2, Math.max(0, Math.floor(frame.head)));
  if (i < 0 || !pts[i + 1]?.transferBefore) return null;
  return clamp01(frame.head - i);
}

/** «разрыв трека»: нейтральная подпись под плашкой, пока голова идёт по пунктирному участку. */
function drawGapNote(env: Env, strength: number, cardAlpha: number): void {
  const f = gapProgress(env.frame, env.data.route);
  if (f === null || env.frame.act !== 'journey') return;
  const alpha = smooth(Math.min(f, 1 - f) / 0.15) * strength * (1 - cardAlpha);
  if (alpha <= 0.01) return;
  const { ctx, layout, skin } = env;
  const x = layout.caption.x;
  const y = layout.caption.y + PLAQUE_ROW_H + 30;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const lead = skin.icons ? 36 : 0;
  if (skin.icons) drawIcon(ctx, 'gap', x + lead / 2, y - 10, lead * 0.9, skin.accent);
  text(env, t(env.lang, 'gap.unknown'), x + (skin.icons ? lead + 14 : 0), y, {
    role: 'secondary', color: skin.muted, maxW: layout.caption.w - lead,
  });
  ctx.restore();
}

/** «маршрут по меткам, не GPS-трек»: постоянная подпись под плашкой на всё время пути, пока слот не занят событием. */
function drawWaypointNote(env: Env, strength: number, cardAlpha: number): void {
  if (!isWaypointRoute(env.data.route) || env.frame.act !== 'journey') return;
  const alpha = strength * (1 - cardAlpha);
  if (alpha <= 0.01) return;
  const { ctx, layout, skin } = env;
  const x = layout.caption.x;
  const y = layout.caption.y + PLAQUE_ROW_H + 30;
  ctx.save();
  ctx.globalAlpha *= alpha;
  const lead = skin.icons ? 36 : 0;
  if (skin.icons) drawIcon(ctx, 'gap', x + lead / 2, y - 10, lead * 0.9, skin.accent);
  text(env, t(env.lang, env.data.route.waypointOrderConfirmed ? 'note.waypoints' : 'note.geographicOverview'), x + (skin.icons ? lead + 14 : 0), y, {
    role: 'secondary', color: skin.muted, maxW: layout.caption.w - lead,
  });
  ctx.restore();
}

// ───────────────────────── «рядом» (плавное появление и гашение от t) ─────────────────────────

const samePlace = (a: Place | null, b: Place | null): boolean =>
  a === b || (a !== null && b !== null && a.nameEn === b.nameEn && a.lat === b.lat && a.lon === b.lon);

/** Ближайшее место, которое было до текущего ряда одинаковых (для перекрёстного гашения); ограничено по глубине. */
function placeBefore(enrichment: Enrichment | null, head: number, current: Place | null): Place | null {
  if (!enrichment) return null;
  let i = Math.max(0, Math.floor(head));
  for (let n = 0; n < 20000 && i >= 0; n++, i--) {
    const p = enrichment.placeAt(i);
    if (!samePlace(p, current)) return p;
  }
  return null;
}

interface PlaceView { cur: Place | null; curAlpha: number; prev: Place | null; prevAlpha: number }

function placeView(env: Env): PlaceView {
  const { frame, data } = env;
  const cur = frame.stats.place;
  if (isWaypointRoute(data.route)) return { cur, curAlpha: cur ? 1 : 0, prev: null, prevAlpha: 0 };
  const pc = frame.placeChange;
  const e = pc ? easeOut((frame.t - pc.at) / PLACE_FADE_SEC) : 1;
  if (e >= 1) return { cur, curAlpha: cur ? 1 : 0, prev: null, prevAlpha: 0 };
  const prev = placeBefore(data.enrichment, frame.head, cur);
  return { cur, curAlpha: cur ? e : 0, prev, prevAlpha: prev ? 1 - e : 0 };
}

// ───────────────────────── показатели ─────────────────────────

interface StatItem {
  key: InfoKey;
  icon: IconKind;
  label: string;
  /** 'num' — табличное число правым краем в зарезервированной ширине и единица после; 'text' — строка слева. */
  kind: 'num' | 'text';
  value: string | null;
  unit: string;
  /** Самые широкие значения за весь ролик — под них резервируется геометрия, чтобы ничего не «ползло». */
  widest: string[];
  /** 'city': «рядом» с перекрёстным гашением. */
  place?: PlaceView;
}

interface RouteExtremes { maxSpeed: number; maxDay: number; minEle: number; maxEle: number }
const extremesCache = new WeakMap<Route, RouteExtremes>();

function extremesOf(route: Route): RouteExtremes {
  const hit = extremesCache.get(route);
  if (hit) return hit;
  let maxSpeed = 0;
  for (const v of route.speedKmh ?? []) if (Number.isFinite(v) && v > maxSpeed) maxSpeed = v;
  let maxDay = route.days ?? 0;
  if (route.day) for (const d of route.day) if (d > maxDay) maxDay = d;
  let minEle = 0, maxEle = 0;
  for (const p of route.points) {
    if (p.ele === undefined) continue;
    if (p.ele < minEle) minEle = p.ele;
    if (p.ele > maxEle) maxEle = p.ele;
  }
  const ex = { maxSpeed, maxDay, minEle, maxEle };
  extremesCache.set(route, ex);
  return ex;
}

/** «1 240 км» → ['1 240', 'км'] (по последнему неразрывному пробелу: единица не отрывается от числа). */
function splitUnit(formatted: string): [string, string] {
  const i = formatted.lastIndexOf(NBSP);
  return i < 0 ? [formatted, ''] : [formatted.slice(0, i), formatted.slice(i + 1)];
}

/** Строка «Рядом»: резервируется всегда, блок не меняет высоту, когда рядом появляется/пропадает город. */
function cityItem(env: Env): StatItem {
  return { key: 'city', icon: 'city', label: t(env.lang, isWaypointRoute(env.data.route) ? 'label.nearMark' : 'label.city'), kind: 'text', value: null, unit: '', widest: [], place: placeView(env) };
}

/**
 * Показатели маршрута по меткам (ADR 0010): расстояния не показываются, «Маршрут» → число различных ночей,
 * «День» → день по меткам. Километража трека, скорости, высоты и дат поездки нет: из меток их не узнать.
 */
function waypointStatItems(env: Env): StatItem[] {
  const { data, frame, lang } = env;
  const { info } = data.settings;
  const facts = journeyFacts(data.route);
  if (!facts) return [];
  const at = factsAt(facts, frame.head);
  const items: StatItem[] = [];
  if (info.progress) {
    items.push({
      key: 'progress', icon: 'tent', label: t(lang, 'label.nights'), kind: 'num',
      value: formatNumber(lang, data.route.waypointOrderConfirmed ? at.nights : facts.nightsTotal), unit: '', widest: [formatNumber(lang, Math.max(1, facts.nightsTotal))],
    });
  }
  if (info.day) {
    items.push({
      key: 'day', icon: 'waypoint', label: t(lang, 'label.marks'), kind: 'num',
      value: formatNumber(lang, data.route.waypointOrderConfirmed ? Math.min(data.route.points.length, Math.floor(frame.head) + 1) : data.route.points.length), unit: '', widest: [formatNumber(lang, data.route.points.length)],
    });
  }
  // Пока город есть, строка занимает место; если название погашено (дубль подписи события), геометрия не меняется, а прочерк и подпись не рисуются (drawStats).
  if (info.city && frame.stats.place) items.push(cityItem(env));
  return items;
}

function statItems(env: Env): StatItem[] {
  if (isWaypointRoute(env.data.route)) return waypointStatItems(env);
  const { data, frame, lang } = env;
  const { info } = data.settings;
  const { route } = data;
  const st = frame.stats;
  const ex = extremesOf(route);
  const items: StatItem[] = [];
  /** Подпись показателя, выведенного из времени: у реконструкции — с пометкой «расчётно». */
  const timed = (key: Parameters<typeof t>[1]): string => (env.reconstruction ? `${t(lang, key)} · ${t(lang, 'mark.estimated')}` : t(lang, key));
  if (info.distance) {
    const [v, unit] = splitUnit(formatDistance(lang, st.distanceKm));
    const wide = [route.totalM / 1000, Math.max(100, route.totalM / 1000)].map((km) => splitUnit(formatDistance(lang, km))[0]);
    items.push({ key: 'distance', icon: 'distance', label: t(lang, route.transfers.length ? 'label.distanceWithGaps' : 'label.distance'), kind: 'num', value: v, unit, widest: wide });
  }
  if (info.progress) {
    items.push({
      key: 'progress', icon: 'progress', label: t(lang, 'label.progress'), kind: 'num',
      value: formatNumber(lang, Math.round(clamp01(st.progress) * 100)), unit: '%', widest: ['100'],
    });
  }
  if (info.day && route.hasTime) {
    items.push({
      key: 'day', icon: 'day', label: timed('label.day'), kind: 'num',
      value: st.day !== undefined ? formatNumber(lang, st.day) : null, unit: '',
      widest: [formatNumber(lang, Math.max(1, ex.maxDay))],
    });
  }
  if (info.date && route.hasTime) {
    items.push({
      key: 'date', icon: 'date', label: timed('label.date'), kind: 'text',
      value: st.date !== undefined ? formatDate(lang, st.date) : null, unit: '',
      widest: Array.from({ length: 12 }, (_, m) => formatDate(lang, Date.UTC(2024, m, 28))),
    });
  }
  if (info.altitude && route.hasEle) {
    const [v, unit] = st.altitudeM !== undefined ? splitUnit(formatAltitude(lang, st.altitudeM)) : [null, ''];
    const fallbackUnit = splitUnit(formatAltitude(lang, 0))[1];
    items.push({
      key: 'altitude', icon: 'altitude', label: t(lang, 'label.altitude'), kind: 'num', value: v, unit: unit || fallbackUnit,
      widest: [ex.maxEle, ex.minEle].map((m) => splitUnit(formatAltitude(lang, m))[0]),
    });
  }
  if (info.speed && route.hasTime) {
    const [v, unit] = st.speedKmh !== undefined ? splitUnit(formatSpeed(lang, st.speedKmh)) : [null, ''];
    const fallbackUnit = splitUnit(formatSpeed(lang, 0))[1];
    items.push({
      key: 'speed', icon: 'speed', label: timed('label.speed'), kind: 'num', value: v, unit: unit || fallbackUnit,
      widest: [splitUnit(formatSpeed(lang, Math.max(10, ex.maxSpeed)))[0]],
    });
  }
  if (info.city) items.push(cityItem(env));
  return items;
}

interface StatsGeo {
  rows: number; cols: number;
  rowH: number; cellW: number;
  left: number; top: number; bottom: number;
  valueSize: number; labelSize: number;
  iconSize: number; textDx: number; textW: number;
}

function widestWidth(env: Env, it: StatItem, size: number): number {
  if (it.kind === 'num') return Math.max(...it.widest.map((s) => numberWidth(env, s, size)));
  return 0;
}

function statsGeometry(env: Env, items: StatItem[]): StatsGeo {
  const { layout, style, data } = env;
  const cols = layout.statsColumns;
  const rows = Math.ceil(items.length / cols);
  const iconSize = env.skin.icons || items.some((it) => it.icon === 'tent') ? 46 : 0;
  const iconGap = iconSize ? 18 : 0;
  const cellW = layout.stats.w / cols;
  const textDx = iconSize + iconGap;
  const textW = cellW - textDx - (cols > 1 ? 30 : 0);
  let labelSize = style.type.label.size;
  let valueSize = style.type.number.size;
  const rowHFor = (vs: number, ls: number) => vs * 0.8 + 14 + ls * 1.05 + 28;
  const maxRowH = layout.stats.h / rows;
  if (rowHFor(valueSize, labelSize) > maxRowH) {
    labelSize = Math.max(30, Math.min(labelSize, Math.floor(maxRowH * 0.25)));
    valueSize = Math.max(44, Math.floor((maxRowH - 14 - labelSize * 1.05 - 28) / 0.8));
  }
  // общий кегль чисел: самая широкая колонка (с единицей) помещается в textW
  for (const it of items) {
    if (it.kind !== 'num') continue;
    for (; valueSize > 44; valueSize -= 1) {
      const unitW = it.unit ? textWidth(env, it.unit, 'secondary', valueSize * 0.5) + 12 : 0;
      if (widestWidth(env, it, valueSize) + unitW <= textW) break;
    }
  }
  const rowH = Math.min(maxRowH, rowHFor(valueSize, labelSize));
  const bottom = layout.statsAnchor === 'bottom'
    ? (data.settings.info.profile && data.route.hasEle ? layout.profile.y - 20 : layout.stats.y + layout.stats.h)
    : layout.stats.y + rows * rowH;
  const top = layout.statsAnchor === 'bottom' ? bottom - rows * rowH : layout.stats.y;
  return { rows, cols, rowH, cellW, left: layout.stats.x, top, bottom, valueSize, labelSize, iconSize, textDx, textW };
}

/** Видимость показателя 0..1: «Рядом» у маршрута по меткам гаснет вместе с названием города; остальные — всегда 1. */
function statVisibility(env: Env, it: StatItem): number {
  return it.place && isWaypointRoute(env.data.route) ? clamp01(it.place.curAlpha + it.place.prevAlpha) : 1;
}

function drawStats(env: Env, items: StatItem[], g: StatsGeo, strength: number): void {
  if (strength <= 0.004 || !items.length) return;
  const { ctx, skin, style } = env;
  const rise = style.motion.appear === 'fade-rise' ? style.motion.rise : 0;
  ctx.save();
  ctx.globalAlpha *= strength;
  ctx.translate(0, (1 - strength) * rise);

  // тонкие разделители: между колонками; у «Атласа» и «Неона» — ещё над сеткой и между рядами
  // Ряд, где все показатели погашены («Рядом» по меткам), не рисует ни разделителей, ни линий; место под ним остаётся занятым (блок не прыгает),
  // а разделитель колонок и линия ряда растут и убывают плавно вместе с видимостью ряда.
  const rowVis = Array.from({ length: g.rows }, (_, r) => {
    const row = items.slice(r * g.cols, (r + 1) * g.cols);
    return row.length ? Math.max(...row.map((it) => statVisibility(env, it))) : 0;
  });
  const visibleRows = rowVis.reduce((a, b) => a + b, 0);
  ctx.strokeStyle = skin.rule;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  if (g.cols > 1 && visibleRows > 0.004) { ctx.moveTo(g.left + g.cellW - 15, g.top + 6); ctx.lineTo(g.left + g.cellW - 15, Math.max(g.top + 6, g.top + visibleRows * g.rowH - 14)); }
  if (skin.rowRules) {
    ctx.moveTo(g.left, g.top - 6); ctx.lineTo(g.left + g.cols * g.cellW, g.top - 6);
  }
  ctx.stroke();
  if (skin.rowRules) {
    for (let r = 1; r < g.rows; r++) {
      if (rowVis[r] <= 0.004) continue;
      ctx.save(); ctx.globalAlpha *= rowVis[r];
      ctx.beginPath(); ctx.moveTo(g.left, g.top + r * g.rowH - 8); ctx.lineTo(g.left + g.cols * g.cellW, g.top + r * g.rowH - 8); ctx.stroke();
      ctx.restore();
    }
  }

  items.forEach((it, i) => {
    const col = i % g.cols, row = Math.floor(i / g.cols);
    const cx0 = g.left + col * g.cellW + (col > 0 ? 30 : 0);
    // текст — по правому краю ячейки: правый край цифр, единиц и подписей один у всех рядов, единицы не «ползут»
    const right = g.left + (col + 1) * g.cellW - (col < g.cols - 1 ? 30 : 0);
    const cy0 = g.top + row * g.rowH;
    const valueBase = cy0 + 6 + g.valueSize * 0.78;
    const labelBase = valueBase + 14 + g.labelSize * 0.78;
    // «Рядом» у маршрута по меткам: нет города (или он гасится как дубль подписи события) — нет и значка, и подписи, и прочерка
    const nearVisible = statVisibility(env, it);
    if (nearVisible <= 0.004) return;
    if (skin.icons || it.icon === 'tent') {
      // Только ночёвки: значок относится к числу, а не к левому краю широкой ячейки. GPS-показатели сохраняют геометрию.
      const unitW = it.unit ? textWidth(env, it.unit, 'secondary', g.valueSize * 0.5) + 12 : 0;
      const iconX = it.icon === 'tent'
        ? right - unitW - numberWidth(env, it.value ?? '—', g.valueSize) - 18 - g.iconSize / 2
        : cx0 + g.iconSize / 2;
      ctx.save(); ctx.globalAlpha *= nearVisible;
      drawIcon(ctx, it.icon, iconX, valueBase - g.valueSize * 0.34, g.iconSize, skin.accent);
      ctx.restore();
    }

    if (it.kind === 'num') {
      const unitW = it.unit ? textWidth(env, it.unit, 'secondary', g.valueSize * 0.5) + 12 : 0;
      const dim = it.value === null ? 0.4 : 1;
      text(env, it.value ?? '—', right - unitW, valueBase, { role: 'number', size: g.valueSize, color: skin.ink, tabular: 'right', alpha: dim });
      if (it.unit) text(env, it.unit, right, valueBase, { role: 'secondary', size: g.valueSize * 0.5, color: skin.muted, align: 'right' });
    } else {
      const size = Math.min(g.valueSize * 0.62, 46);
      const opts = { role: 'number' as const, size, color: skin.ink, maxW: g.textW, minSize: 28, weight: style.type.title.weight, align: 'right' as const };
      if (it.place) {
        const pv = it.place;
        const dash = 0.4 * (1 - clamp01(pv.curAlpha + pv.prevAlpha));
        if (dash > 0.004 && !isWaypointRoute(env.data.route)) text(env, '—', right, valueBase, { ...opts, alpha: dash });
        if (pv.prev && pv.prevAlpha > 0.004) text(env, placeName(env.lang, pv.prev), right, valueBase, { ...opts, alpha: pv.prevAlpha });
        if (pv.cur && pv.curAlpha > 0.004) text(env, placeName(env.lang, pv.cur), right, valueBase, { ...opts, alpha: pv.curAlpha });
      } else {
        text(env, it.value ?? '—', right, valueBase, { ...opts, alpha: it.value === null ? 0.4 : 1 });
      }
    }
    text(env, it.label, right, labelBase, { role: 'label', size: g.labelSize, color: skin.muted, maxW: g.textW, minSize: 22, align: 'right', alpha: nearVisible });
  });
  ctx.restore();
}

// ───────────────────────── профиль высот ─────────────────────────

interface ProfileModel { fr: Float32Array; ele: Float32Array; min: number; max: number }
const profileCache = new WeakMap<Route, ProfileModel>();
const PROFILE_SAMPLES = 180;

/** Высота по доле пройденного пути, PROFILE_SAMPLES отсчётов (среднее по корзине); считается один раз на маршрут. */
function profileOf(route: Route): ProfileModel | null {
  const hit = profileCache.get(route);
  if (hit) return hit;
  const pts = route.points;
  if (!route.hasEle || route.totalM <= 0 || pts.length < 2) return null;
  const sum = new Float64Array(PROFILE_SAMPLES), cnt = new Uint32Array(PROFILE_SAMPLES);
  for (const p of pts) {
    if (p.ele === undefined) continue;
    const b = Math.min(PROFILE_SAMPLES - 1, Math.floor((p.d / route.totalM) * PROFILE_SAMPLES));
    sum[b] += p.ele; cnt[b]++;
  }
  const ele = new Float32Array(PROFILE_SAMPLES);
  let last = Number.NaN;
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    if (cnt[i]) last = sum[i] / cnt[i];
    ele[i] = last;
  }
  // первые пустые корзины (если есть) — по первой известной высоте
  const first = ele.find((v) => Number.isFinite(v));
  if (first === undefined) return null;
  for (let i = 0; i < PROFILE_SAMPLES && !Number.isFinite(ele[i]); i++) ele[i] = first;
  const fr = new Float32Array(PROFILE_SAMPLES);
  for (let i = 0; i < PROFILE_SAMPLES; i++) fr[i] = (i + 0.5) / PROFILE_SAMPLES;
  let min = Infinity, max = -Infinity;
  for (const v of ele) { if (v < min) min = v; if (v > max) max = v; }
  const model = { fr, ele, min, max };
  profileCache.set(route, model);
  return model;
}

/** Профиль — тонкая полоса прямо на карте, без подложки: пройденная часть яркая, остальное — бледный след. */
function drawProfile(env: Env, strength: number): void {
  const { ctx, layout, skin, frame, lang, data } = env;
  const model = data.settings.info.profile ? profileOf(data.route) : null;
  if (!model || strength <= 0.004) return;
  const box = layout.profile;
  ctx.save();
  ctx.globalAlpha *= strength;

  const capSize = 28;
  text(env, t(lang, 'label.profile'), box.x, box.y + capSize * 0.8, { role: 'secondary', size: capSize, color: skin.muted });
  text(env, formatAltitude(lang, model.max), box.x + box.w, box.y + capSize * 0.8, { role: 'secondary', size: capSize, color: skin.accent, align: 'right' });

  const cx = box.x, cw = box.w;
  const cy = box.y + capSize + 10, ch = box.h - capSize - 12;
  const span = Math.max(1, model.max - model.min);
  const X = (f: number) => cx + f * cw;
  const Y = (e: number) => cy + ch - ((e - model.min) / span) * ch * 0.94;
  const n = model.fr.length;
  const trace = (closed: boolean) => {
    ctx.beginPath();
    ctx.moveTo(cx, Y(model.ele[0]));
    for (let i = 0; i < n; i++) ctx.lineTo(X(model.fr[i]), Y(model.ele[i]));
    ctx.lineTo(cx + cw, Y(model.ele[n - 1]));
    if (closed) { ctx.lineTo(cx + cw, cy + ch); ctx.lineTo(cx, cy + ch); ctx.closePath(); }
  };

  const px = X(clamp01(frame.stats.progress));
  ctx.save();
  ctx.beginPath(); ctx.rect(cx - 2, box.y, px - cx + 2, box.h); ctx.clip();
  const g = ctx.createLinearGradient(0, cy, 0, cy + ch);
  g.addColorStop(0, withAlpha(skin.accent, 0.5));
  g.addColorStop(1, withAlpha(skin.accent, 0.04));
  ctx.fillStyle = g;
  trace(true);
  ctx.fill();
  ctx.lineWidth = 3.4; ctx.lineJoin = 'round';
  ctx.strokeStyle = skin.accent;
  trace(false);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(px, box.y, cx + cw - px + 2, box.h); ctx.clip();
  ctx.fillStyle = withAlpha(skin.ink, 0.12);
  trace(true);
  ctx.fill();
  ctx.lineWidth = 2.4; ctx.lineJoin = 'round';
  ctx.strokeStyle = withAlpha(skin.ink, 0.45);
  trace(false);
  ctx.stroke();
  ctx.restore();

  // бегущая отметка
  const idx = clamp01(frame.stats.progress) * (n - 1);
  const i0 = Math.floor(idx), i1 = Math.min(n - 1, i0 + 1);
  const ey = Y(model.ele[i0] + (model.ele[i1] - model.ele[i0]) * (idx - i0));
  ctx.fillStyle = skin.accent;
  ctx.beginPath(); ctx.arc(px, ey, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = env.style.id === 'atlas' ? '#F7F2E6' : '#FFFFFF';
  ctx.beginPath(); ctx.arc(px, ey, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ───────────────────────── полоса прогресса ─────────────────────────

function drawProgress(env: Env, strength: number): void {
  if (isWaypointRoute(env.data.route) && !env.data.route.waypointOrderConfirmed) return;
  const { ctx, layout, skin, data, frame } = env;
  if (!data.settings.info.progress || strength <= 0.004) return;
  const r = layout.progress;
  const p = clamp01(frame.stats.progress);
  const barH = 6;
  const by = r.y + (r.h - barH) / 2;
  ctx.save();
  ctx.globalAlpha *= strength;
  ctx.fillStyle = withAlpha(skin.ink, env.style.id === 'atlas' ? 0.2 : 0.26);
  roundPath(ctx, r.x, by, r.w, barH, barH / 2);
  ctx.fill();
  if (p > 0.001) {
    ctx.fillStyle = skin.accent;
    roundPath(ctx, r.x, by, Math.max(barH, r.w * p), barH, barH / 2);
    ctx.fill();
  }
  // засечки въездов в страны
  const runs = data.enrichment?.countryRuns ?? [];
  const total = data.route.totalM;
  const byMarks = isWaypointRoute(data.route); // у меток нет длины пути: доля — по номеру метки, как и сам прогресс
  const lastMark = data.route.points.length - 1;
  if (total > 0 || (byMarks && lastMark > 0)) {
    ctx.fillStyle = withAlpha(skin.ink, 0.8);
    for (const run of runs.slice(1)) {
      if (!run.country) continue;
      const f = byMarks ? run.fromIdx / lastMark : data.route.points[run.fromIdx].d / total;
      ctx.beginPath(); ctx.arc(r.x + r.w * f, r.y + r.h / 2, 3.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  // бегунок
  ctx.fillStyle = env.style.id === 'atlas' ? '#F7F2E6' : '#FFFFFF';
  ctx.strokeStyle = skin.accent;
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(r.x + r.w * p, r.y + r.h / 2, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();
}

// ───────────────────────── заголовок интро и финала ─────────────────────────

interface TitleGeo {
  title: TitleLayout;
  leadingPx: number;
  textBottom: number;
  ruleY: number;
  kickerBase: number;
  authorBase: number;
  blockBottom: number;
  range: string;
  author: string;
}

function titleGeometry(env: Env, mode: 'intro' | 'outro'): TitleGeo {
  const { ctx, layout, style, skin, lang, data } = env;
  const r = layout.title;
  const route = data.route;
  const rawTitle = resolveTitle(lang, data.settings.title, route, data.enrichment);
  const role = style.type.title;
  const measure: Measurer = (str, size) => {
    ctx.font = fontCss(role.family, role.weight, size);
    setTracking(ctx, role.tracking * size);
    return richWidth(ctx, str);
  };
  ctx.save();
  const title = layoutTitle(rawTitle, measure, r.w, layout.titleMaxLines, role.max, role.min, r.h, skin.leading);
  ctx.restore();
  const leadingPx = title.size * skin.leading;
  const textBottom = r.y + title.lines.length * leadingPx;
  const author = localizeAuthor(lang, data.settings.author);
  const dates = mode === 'intro' && route.hasTime && route.startTime !== undefined && route.endTime !== undefined
    ? formatDateRange(lang, route.startTime, route.endTime) : '';
  // маршрут по меткам: дат поездки нет — на их месте честная подпись, что это метки, а не GPS-трек
  const range = isWaypointRoute(route) ? t(lang, route.waypointOrderConfirmed ? 'note.waypoints' : 'note.geographicOverview') : dates && env.reconstruction ? `${dates} · ${t(lang, 'mark.estimated')}` : dates;
  const ruleY = textBottom + 16;
  let y = ruleY + 22;
  const kickerBase = range ? y + style.type.kicker.size * 0.9 : y;
  if (range) y = kickerBase + 14;
  const authorBase = author ? y + style.type.secondary.size * 0.9 : y;
  const blockBottom = author ? authorBase + 12 : range ? kickerBase + 12 : ruleY + 10;
  return { title, leadingPx, textBottom, ruleY, kickerBase, authorBase, blockBottom, range, author };
}

/** Блок «заголовок / черта / даты / автор». enter — анимация появления (0..1), alpha — прозрачность блока. */
function drawTitleBlock(env: Env, geo: TitleGeo, alpha: number, enter: number): void {
  if (alpha <= 0.004) return;
  const { ctx, layout, style, skin } = env;
  const r = layout.title;
  const { title } = geo;
  const motion = style.motion;
  const rise = motion.appear === 'fade-rise' ? (1 - easeOut(enter)) * motion.rise : 0;
  const role = style.type.title;

  ctx.save();
  ctx.globalAlpha *= alpha * (motion.appear === 'fade' ? easeOut(enter * 1.2 + 0.2) : 1);
  ctx.translate(0, rise);
  ctx.textBaseline = 'alphabetic';
  if (skin.shadow) { ctx.shadowColor = skin.shadow; ctx.shadowBlur = 22 * env.k; ctx.shadowOffsetY = 3 * env.k; }

  ctx.font = fontCss(role.family, role.weight, title.size);
  setTracking(ctx, role.tracking * title.size);
  ctx.fillStyle = skin.ink;
  title.lines.forEach((line, i) => richFill(ctx, line, r.x, r.y + title.size * 0.8 + i * geo.leadingPx));
  setTracking(ctx, 0);
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

  // черта: у «Атласа» — тонкая линейка на всю ширину с короткой акцентной вставкой; у остальных — короткая акцентная
  const grow = easeOut((enter - 0.1) / 0.6);
  const barW = 96 * grow;
  if (style.id === 'atlas') {
    ctx.strokeStyle = skin.rule;
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(r.x, geo.ruleY); ctx.lineTo(r.x + r.w * grow, geo.ruleY); ctx.stroke();
  }
  if (barW > 1) {
    ctx.fillStyle = skin.accent;
    ctx.fillRect(r.x, geo.ruleY - 2, barW, 4);
  }

  if (geo.range) text(env, geo.range, r.x, geo.kickerBase, { role: 'kicker', color: skin.accent, maxW: r.w, minSize: 18, alpha: easeOut((enter - 0.1) / 0.6) });
  if (geo.author) text(env, geo.author, r.x, geo.authorBase, { role: 'secondary', color: skin.muted, maxW: r.w, minSize: 18, alpha: easeOut((enter - 0.2) / 0.6) });
  ctx.restore();
}

// ───────────────────────── итоги финала ─────────────────────────

interface Metric { value: string; unit: string; caption: string; count: number; decimals: boolean }

/** Итог по меткам: ночёвки, страны и дни по меткам. Расстояния не являются длиной пути. */
function waypointSummaryMetrics(env: Env): { hero: Metric; extra: Metric[] } | null {
  const { data, lang } = env;
  const facts = journeyFacts(data.route);
  if (!facts) return null;
  const nights = facts.nightsTotal;
  const hero: Metric = { value: formatNumber(lang, nights), unit: '', caption: t(lang, 'summary.overnightPlaces', { n: nights }), count: nights, decimals: false };
  const extra: Metric[] = [];
  const countries = data.enrichment?.countries.length ?? 0;
  if (countries > 0) extra.push({ value: formatNumber(lang, countries), unit: '', caption: t(lang, 'summary.countries', { n: countries }), count: countries, decimals: false });
  const marks = data.route.points.length;
  extra.push({ value: formatNumber(lang, marks), unit: '', caption: t(lang, 'summary.marks', { n: marks }), count: marks, decimals: false });
  return { hero, extra };
}

function summaryMetrics(env: Env): { hero: Metric; extra: Metric[] } {
  const { data, lang } = env;
  const { route, enrichment } = data;
  const byMarks = waypointSummaryMetrics(env);
  if (byMarks) return byMarks;
  const km = (route.transfers.length ? route.ownM : route.totalM) / 1000;
  const [kmText, kmUnit] = splitUnit(formatDistance(lang, km));
  const hero: Metric = { value: kmText, unit: kmUnit, caption: t(lang, route.transfers.length ? 'summary.recordedDistance' : 'summary.distance'), count: km, decimals: km < 100 };
  const extra: Metric[] = [];
  if (route.hasTime && route.days) {
    const days = t(lang, 'summary.days', { n: route.days });
    extra.push({ value: formatNumber(lang, route.days), unit: '', caption: env.reconstruction ? `${days} · ${t(lang, 'mark.estimated')}` : days, count: route.days, decimals: false });
  }
  const countries = enrichment?.countries.length ?? 0;
  if (countries > 0) {
    extra.push({ value: formatNumber(lang, countries), unit: '', caption: t(lang, 'summary.countries', { n: countries }), count: countries, decimals: false });
  }
  if (route.hasEle && route.maxEle) {
    const [m, mUnit] = splitUnit(formatAltitude(lang, route.maxEle.value));
    extra.push({ value: m, unit: mUnit, caption: t(lang, 'summary.maxAltitude'), count: route.maxEle.value, decimals: false });
  }
  return { hero, extra };
}

/** Число набирается от нуля, пока проявляется итог; на последнем кадре — точное значение. */
function countedText(env: Env, m: Metric, outro: number): string {
  if (outro >= 0.999) return m.value;
  const e = easeOut(outro * 1.25);
  const v = m.count * e;
  return formatNumber(env.lang, m.decimals ? Math.round(v * 10) / 10 : Math.round(v), m.decimals ? 1 : 0);
}

/** Подпись «по треку N км · разрывы M км» — только если у маршрута есть разрывы (переезды). */
function trackLines(env: Env): string[] {
  const { route } = env.data;
  if (route.transfers.length === 0) return [];
  const own = formatDistance(env.lang, route.ownM / 1000);
  const gaps = formatDistance(env.lang, (route.totalM - route.ownM) / 1000);
  return [t(env.lang, 'summary.byTrack', { km: own }), t(env.lang, 'summary.gapStraight', { km: gaps })];
}

/** Число с единицей: число — табличное, правым краем зарезервированной ширины (по итоговому значению), единица стоит на месте. */
function drawValue(env: Env, m: Metric, outro: number, x: number, baseline: number, size: number, color: string, maxW: number): void {
  let s = size;
  const unitRatio = 0.4;
  for (; s > 30; s -= 1) {
    const unitW = m.unit ? textWidth(env, m.unit, 'secondary', s * unitRatio) + 12 : 0;
    if (numberWidth(env, m.value, s) + unitW <= maxW) break;
  }
  const reserved = numberWidth(env, m.value, s);
  text(env, countedText(env, m, outro), x + reserved, baseline, { role: 'number', size: s, color, tabular: 'right' });
  if (m.unit) text(env, m.unit, x + reserved + 12, baseline, { role: 'secondary', size: s * unitRatio, color: env.skin.muted });
}

function drawSummary(env: Env, outro: number): void {
  if (outro <= 0.004) return;
  const { ctx, layout, style, skin, lang } = env;
  const { hero, extra } = summaryMetrics(env);
  const box = layout.summary;
  const e = easeOut(outro);
  const motion = style.motion;
  const lines = trackLines(env);
  const dock = layout.summaryDock;
  const scale = layout.readability.summaryScale;
  const labelSize = style.type.label.size * scale;
  const heroSize = Math.round(style.type.number.size * (dock === 'bottom' ? 1.55 : 1.5) * scale);

  ctx.save();
  ctx.globalAlpha *= clamp01(outro * 1.4);
  ctx.translate(0, motion.appear === 'fade-rise' ? (1 - e) * motion.rise : 0);

  // шапка: линейка и надзаголовок
  ctx.strokeStyle = skin.rule;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(box.x, box.y); ctx.lineTo(box.x + box.w, box.y); ctx.stroke();
  ctx.fillStyle = skin.accent;
  ctx.fillRect(box.x, box.y - 2, 96, 4);
  text(env, t(lang, env.frame.shot && !isWaypointRoute(env.data.route) ? 'film.summary' : 'summary.title'), box.x, box.y + 44, { role: 'kicker', size: style.type.kicker.size * scale, color: skin.accent, maxW: box.w, minSize: 18 });

  // главное — расстояние
  const heroBase = box.y + 44 + 22 + heroSize * 0.78;
  drawValue(env, hero, outro, box.x, heroBase, heroSize, skin.ink, box.w);
  const capBase = heroBase + 16 + labelSize * 0.78;
  text(env, hero.caption, box.x, capBase, { role: 'label', size: labelSize, color: skin.muted, maxW: box.w, minSize: 22 });
  let noteBase = capBase;
  if (lines.length) {
    const joined = lines.join('  ·  ');
    const secSize = style.type.secondary.size;
    const oneLine = textWidth(env, joined, 'secondary', secSize) <= box.w;
    const parts = oneLine ? [joined] : lines;
    parts.forEach((ln, i) => {
      noteBase = capBase + 12 + secSize * 0.9 + i * (secSize * 1.25);
      text(env, ln, box.x, noteBase, { role: 'secondary', color: skin.muted, maxW: box.w, minSize: 18 });
    });
  }

  if (dock === 'bottom') {
    // 2–3 показателя помельче — в ряд внизу
    const top = Math.max(noteBase + 22, box.y + 246);
    const n = extra.length;
    if (n) {
      ctx.strokeStyle = skin.rule;
      ctx.beginPath(); ctx.moveTo(box.x, top); ctx.lineTo(box.x + box.w, top); ctx.stroke();
      const cellW = box.w / n;
      const vs = Math.round(style.type.number.size * 0.78);
      extra.forEach((m, i) => {
        const x0 = box.x + i * cellW + (i > 0 ? 24 : 0);
        const inner = cellW - (i > 0 ? 24 : 0) - 16;
        drawValue(env, m, outro, x0, top + 18 + vs * 0.78, vs, skin.ink, inner);
        text(env, m.caption, x0, top + 18 + vs * 0.78 + 12 + style.type.label.size * 0.78, { role: 'label', color: skin.muted, maxW: inner, minSize: 22 });
        if (i > 0) {
          ctx.strokeStyle = skin.rule;
          ctx.beginPath(); ctx.moveTo(box.x + i * cellW, top + 14); ctx.lineTo(box.x + i * cellW, box.y + box.h - 10); ctx.stroke();
        }
      });
    }
  } else {
    // колонка справа: подпись слева, число — правым краем
    let y = Math.max(noteBase + 30, box.y + 290);
    const rowH = 76;
    const vs = Math.round(style.type.number.size * 0.75 * scale);
    extra.forEach((m) => {
      ctx.strokeStyle = skin.rule;
      ctx.beginPath(); ctx.moveTo(box.x, y); ctx.lineTo(box.x + box.w, y); ctx.stroke();
      const unitW = m.unit ? textWidth(env, m.unit, 'secondary', vs * 0.4) + 12 : 0;
      const numW = numberWidth(env, m.value, vs);
      const base = y + 14 + vs * 0.78;
      text(env, m.caption, box.x, base, { role: 'label', size: labelSize, color: skin.muted, maxW: box.w - numW - unitW - 24, minSize: 22 });
      drawValue(env, m, outro, box.x + box.w - numW - unitW, base, vs, skin.ink, box.w * 0.6);
      y += rowH;
    });
  }
  ctx.restore();
}

// ───────────────────────── атрибуция карты ─────────────────────────

function attributionGeometry(env: Env): { lines: string[]; size: number; baseline: number; rect: Rect } {
  const { ctx, layout, style } = env;
  const { width, height } = layout;
  ctx.save();
  const attribution = attributionText(env.lang, style.attribution);
  let size = Math.round(Math.min(width, height) * 0.0185);
  const wide = layout.format === '16:9';
  const minSize = wide ? 14 : 16;
  const maxLines = wide ? 2 : 4;
  // Четыре строки под прогрессом: нижняя базовая линия оставляет запас до safe y=1536.
  const baseline = wide
    ? (env.data.settings.info.profile && env.data.route.hasEle ? layout.profile.y - 12 : layout.attribution.y)
    : layout.attribution.y + 8;
  setTracking(ctx, 0);
  // Полная атрибуция, включая новые векторные детали, помещается и в вертикальном кадре.
  let lines: string[] = [];
  const maxWidth = layout.attribution.w;
  // Сохраняем прежнюю полосу под прогрессом (9:16) / над ним (16:9), не сокращая текст.
  for (; size >= minSize; size--) {
    ctx.font = fontCss(style.type.secondary.family, 500, size);
    lines = [];
    let line = '';
    for (const word of attribution.split(' ')) {
      if (line && ctx.measureText(`${line} ${word}`).width > maxWidth) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
    const top = baseline - (lines.length - 1) * size * 1.25 - size;
    const fitsBand = wide || top >= Math.max(layout.progress.y + layout.progress.h, layout.summary.y + layout.summary.h) + 4;
    if ((lines.length <= maxLines && fitsBand) || size === minSize) break;
  }
  // Не оставляем короткий хвост провайдеров отдельной строкой; текст сохраняется целиком.
  if (lines.length > 1) {
    const last = lines.length - 1;
    const words = lines[last - 1].split(' ');
    while (words.length > 1 && ctx.measureText(lines[last]).width < maxWidth * 0.4) {
      const next = `${words[words.length - 1]} ${lines[last]}`;
      if (ctx.measureText(next).width > maxWidth) break;
      words.pop(); lines[last] = next;
    }
    lines[last - 1] = words.join(' ');
  }
  ctx.restore();
  const top = baseline - (lines.length - 1) * size * 1.25 - size;
  return { lines, size, baseline, rect: { x: layout.attribution.x, y: top, w: maxWidth, h: baseline + size * 0.25 - top } };
}

/** Та же область полной атрибуции для обхода географическими выносками. */
export function overlayAttributionRect(ctx: Ctx, frame: FrameState, data: OverlayData): Rect {
  const style = data.style;
  return attributionGeometry({ ctx, frame, data, style, layout: layoutFor(data.settings.format, style.id),
    skin: SKINS[style.id], lang: data.settings.lang, k: canvasScale(ctx), reconstruction: data.reconstruction }).rect;
}

function drawAttribution(env: Env): void {
  const { ctx, layout, style } = env;
  const { lines, size, baseline } = attributionGeometry(env);
  const light = style.id === 'atlas';
  ctx.save();
  ctx.font = fontCss(style.type.secondary.family, 500, size);
  setTracking(ctx, 0);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = light ? 'rgba(31,51,45,0.82)' : 'rgba(255,255,255,0.8)';
  ctx.shadowColor = light ? 'rgba(244,240,230,0.85)' : 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 4 * env.k;
  ctx.strokeStyle = light ? 'rgba(244,240,230,0.95)' : 'rgba(0,0,0,0.9)';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.2;
  lines.forEach((line, i) => {
    const y = baseline - (lines.length - 1 - i) * size * 1.25;
    ctx.strokeText(line, layout.attribution.x, y);
    ctx.fillText(line, layout.attribution.x, y);
  });
  ctx.restore();
}

// ───────────────────────── вход ─────────────────────────

/** Когда кончается интро (секунды): таблица актов раскадровки. */
function introEndOf(durationSec: number): number {
  return (ACTS as Record<number, { intro: number }>)[durationSec]?.intro ?? durationSec * 0.1;
}

/**
 * Оформление кадра поверх карты и трека. ctx — в дизайн-пикселях (1080×1920 / 1920×1080).
 * Кадр — чистая функция от `frame` и данных: между кадрами ничего не хранится, перемотка даёт тот же результат.
 */
/** Нижняя граница полного титра, включая даты и автора, в дизайн-пикселях. */
export function overlayTitleBottom(ctx: CanvasRenderingContext2D, frame: FrameState, data: OverlayData): number {
  const style = data.style;
  const env: Env = { ctx, frame, data, style, layout: layoutFor(data.settings.format, style.id),
    skin: SKINS[style.id], lang: data.settings.lang, k: canvasScale(ctx), reconstruction: data.reconstruction };
  return titleGeometry(env, frame.act === 'outro' ? 'outro' : 'intro').blockBottom;
}

const OUTRO_SPLIT = 0.4, SLOT_SPLIT = 0.35;
function overlayPhases(frame: FrameState, settings: StorySettings, style: StyleDef) {
  const outro = frame.act === 'outro' ? smooth((frame.outroAlpha - OUTRO_SPLIT) / (1 - OUTRO_SPLIT)) : 0;
  const hud = frame.act === 'intro' ? 0
    : frame.act === 'outro' ? 1 - smooth(frame.outroAlpha / OUTRO_SPLIT)
      : smooth((frame.t - introEndOf(settings.durationSec)) / Math.max(0.4, style.motion.appearSec));
  const card = frame.cards[0];
  const shown = card && !(card.beat.kind === 'country' && settings.info.country) ? card : null;
  const raw = shown ? clamp01(shown.alpha) : 0;
  return { outro, hud, shown, raw, plaqueShare: shown?.chapter ? 1 : 1 - smooth(raw / SLOT_SPLIT),
    cardAlpha: smooth((raw - SLOT_SPLIT) / (1 - SLOT_SPLIT)) };
}

/** Только видимая глава: те же фазы и пороги, что у рисования. */
export function overlayChapterRect(ctx: CanvasRenderingContext2D, frame: FrameState, data: OverlayData): Rect | null {
  const { outro, hud, shown, cardAlpha } = overlayPhases(frame, data.settings, data.style);
  const chapter = frame.act === 'outro' && outro > 0 && frame.finalChapter ? frame.finalChapter
    : hud > 0.004 && cardAlpha > 0.004 ? shown?.chapter : undefined;
  if (!chapter) return null;
  const style = data.style;
  const env: Env = { ctx, frame, data, style, layout: layoutFor(data.settings.format, style.id),
    skin: SKINS[style.id], lang: data.settings.lang, k: canvasScale(ctx), reconstruction: data.reconstruction };
  return chapterGeometry(env, chapter).rect;
}

const chapterReserveCache = new WeakMap<Route, {
  chapters: Route['chapters']; enrichment: Enrichment | null;
  matched: ReturnType<typeof matchChapters>; rects: Map<string, Rect | null>;
}>();
/** Постоянный резерв на весь акт; не зависит от текущей карточки и её прозрачности. */
export function overlayChapterReserve(ctx: CanvasRenderingContext2D, frame: FrameState, data: OverlayData): Rect | null {
  if (frame.act === 'intro' || !data.route.chapters?.length) return null;
  let cache = chapterReserveCache.get(data.route);
  if (!cache || cache.chapters !== data.route.chapters || cache.enrichment !== data.enrichment) {
    cache = { chapters: data.route.chapters, enrichment: data.enrichment,
      matched: data.enrichment ? matchChapters(data.route, data.enrichment) : [], rects: new Map() };
    chapterReserveCache.set(data.route, cache);
  }
  const style = data.style;
  const env: Env = { ctx, frame, data, style, layout: layoutFor(data.settings.format, style.id),
    skin: SKINS[style.id], lang: data.settings.lang, k: canvasScale(ctx), reconstruction: data.reconstruction };
  const key = `${chapterGeometryKey(env)}|${frame.act}`;
  if (cache.rects.has(key)) return cache.rects.get(key)!;
  // Финальная глава не входит в карточки пути; в финале резервируем её ещё до проявления.
  const chapters = frame.act === 'outro' ? cache.matched.filter(m => m.chapter.finale).slice(0, 1)
    : cache.matched.filter(m => !m.chapter.finale);
  let rect: Rect | null = null;
  for (const { chapter } of chapters) {
    const next = chapterGeometry(env, chapter).rect;
    if (!rect || next.y + next.h > rect.y + rect.h) rect = next;
  }
  cache.rects.set(key, rect);
  return rect;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, frame: FrameState, data: OverlayData): void {
  const { settings, style } = data;
  const overview = isWaypointRoute(data.route) && !data.route.waypointOrderConfirmed
    ? overviewLabels(data.route, data.enrichment, frame.camera, MAP_VIEWPORT[settings.format]) : undefined;
  if (overview) frame = { ...frame, stats: { ...frame.stats, country: overview.country, place: overview.place } };
  const layout = layoutFor(settings.format, style.id);
  const env: Env = {
    ctx, frame, data, layout, style, overview, skin: SKINS[style.id], lang: settings.lang, k: canvasScale(ctx),
    reconstruction: data.reconstruction,
  };
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  setTracking(ctx, 0);

  const tone = chapterToneFor(style.id, frame.chapterMood);
  if (tone.strength > 0) {
    ctx.save(); ctx.globalAlpha = tone.strength;
    ctx.fillStyle = `rgb(${tone.rgb.map(Math.round).join(',')})`;
    ctx.fillRect(0, 0, layout.width, layout.height); ctx.restore();
  }

  // оформление пути проявляется после интро: заголовок уже погас, показателей ещё нет — они не бывают вместе
  // вход в финал — по очереди, без наложения: сначала гаснет оформление пути (плашка, показатели), затем проявляются
  // заголовок и итоги (в слоте заголовка и в зоне итогов в один момент виден только один из двух слоёв)
  const { outro, hud, shown, raw, plaqueShare, cardAlpha } = overlayPhases(frame, settings, style);
  const wide = layout.format === '16:9';

  if (frame.act === 'intro' || frame.act === 'outro') {
    const mode = frame.act;
    const geo = titleGeometry(env, mode);
    const a = mode === 'intro' ? frame.introAlpha : outro;
    const enter = mode === 'intro' ? clamp01(frame.t / Math.max(0.3, style.motion.appearSec)) : outro;
    if (wide) scrimBlob(env, layout.title.x + 480, layout.title.y + 130, 840, 300, a);
    else scrimBand(env, 0, geo.blockBottom + 90, a, 'top');
    if (mode === 'outro' && frame.finalChapter) drawChapterCaption(env, frame.finalChapter, a);
    else drawTitleBlock(env, geo, a, enter);
  }

  if (frame.act === 'outro') {
    if (wide) scrimBlob(env, layout.summary.x + layout.summary.w / 2, layout.summary.y + layout.summary.h / 2, 520, 420, outro);
    else scrimBand(env, layout.summary.y - 170, layout.height, outro, 'bottom');
  }

  if (hud > 0.004) {
    // при включённой «Стране» въезд показывает плашка — отдельная карточка была бы дублем
    // Обычные события заменяют плашку; глава занимает отдельную зону ниже неё.
    // показатели пути — только когда голова пошла по маршруту (на спуске к старту она может стоять под зоной показателей)
    const moving = isWaypointRoute(data.route) && !data.route.waypointOrderConfirmed ? 1 : smooth(frame.stats.progress / 0.012);
    const stats = hud * moving;
    const items = statItems(env);
    const geo = items.length ? statsGeometry(env, items) : null;

    // подложки под оформлением пути
    ctx.save();
    ctx.globalAlpha = 1;
    if (wide) {
      scrimBlob(env, layout.caption.x + 300, layout.caption.y + 70, 560, 210, 0.7 * hud);
      if (geo) scrimBlob(env, geo.left + geo.cols * geo.cellW / 2, geo.top + (geo.bottom - geo.top) / 2, 420, (geo.bottom - geo.top) / 2 + 240, 0.85 * stats);
      if (data.settings.info.profile && data.route.hasEle) scrimBand(env, layout.profile.y - 90, layout.height, 0.6 * stats, 'bottom');
    } else {
      scrimBand(env, 0, layout.caption.y + layout.caption.h + 80, 0.6 * hud, 'top');
      if (geo) scrimBand(env, geo.top - 150, layout.height, 0.78 * stats, 'bottom');
    }
    ctx.restore();

    // Плашка страны остаётся видимой во время главы в отдельной зоне.
    drawCountryPlaque(env, hud * plaqueShare);
    if (shown && cardAlpha > 0.004) drawEventCard(env, { ...shown, alpha: cardAlpha }, 1); // карточки бывают только в пути
    const noteAlpha = shown?.chapter ? smooth(raw / SLOT_SPLIT) : raw;
    drawGapNote(env, hud, noteAlpha);
    drawWaypointNote(env, hud, noteAlpha);

    // «рядом» не повторяет название места из событийной подписи
    const dup = shown && !shown.chapter && (shown.beat.kind === 'start' || shown.beat.kind === 'finish' || shown.beat.kind === 'waypoint') ? 1 - raw : 1;
    for (const it of items) {
      if (it.place) it.place = { ...it.place, curAlpha: it.place.curAlpha * dup, prevAlpha: it.place.prevAlpha * dup };
    }
    if (geo) drawStats(env, items, geo, stats);
    drawProfile(env, stats);
    drawProgress(env, stats);
  }
  if (frame.act === 'outro') drawSummary(env, outro);
  drawAttribution(env);
  ctx.restore();
}

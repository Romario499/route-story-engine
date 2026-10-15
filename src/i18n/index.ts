// Тексты ролика RU/EN (чистый модуль: без DOM, window, fetch). Интерфейс приложения — по-русски в src/ui/.
import type { Beat, CaptionSource, Chapter, Country, Lang, Place, TransportChange } from '../types';
import { EN, RU, type Message, type OverlayKey, type Vars } from './messages';

export type { OverlayKey } from './messages';
export { ruPlural } from './messages';

const DICT: Record<Lang, Record<OverlayKey, Message>> = { ru: RU, en: EN };

/** Все ключи текстов ролика. */
export const OVERLAY_KEYS = Object.keys(RU) as OverlayKey[];

/** Текст ролика по ключу; `{name}` заменяется из vars, `n` выбирает форму множественного числа. */
export function t(lang: Lang, key: OverlayKey, vars: Vars = {}): string {
  const msg = DICT[lang][key] ?? RU[key];
  const text = typeof msg === 'function' ? msg(vars) : msg;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

const NBSP = ' ';

/** Локализуем пояснения атрибуции стиля, сохраняя имена источников и ссылки дословно. */
export function attributionText(lang: Lang, attribution: string): string {
  if (lang === 'ru') return attribution;
  return attribution
    .replace(new RegExp(t('ru', 'attribution.data'), 'gi'), t(lang, 'attribution.data'))
    .replace(t('ru', 'attribution.colourAdjusted'), t(lang, 'attribution.colourAdjusted'));
}
const LOCALE: Record<Lang, string> = { ru: 'ru-RU', en: 'en-GB' };
const fmtCache = new Map<string, Intl.NumberFormat>();
function numberFormat(lang: Lang, digits: number): Intl.NumberFormat {
  const key = `${lang}:${digits}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    fmtCache.set(key, f);
  }
  return f;
}

/** Число по локали: ru — «1 234,5», en — «1,234.5». */
export function formatNumber(lang: Lang, value: number, digits = 0): string {
  return numberFormat(lang, digits).format(value);
}

const UNIT = {
  km: { ru: 'км', en: 'km' },
  m: { ru: 'м', en: 'm' },
  kmh: { ru: 'км/ч', en: 'km/h' },
} as const;

/** «12,3 км» / «1 235 км»: до 100 км — с десятой, дальше — целые. */
export function formatDistance(lang: Lang, km: number): string {
  return `${formatNumber(lang, km, km < 100 ? 1 : 0)}${NBSP}${UNIT.km[lang]}`;
}

/** «3 120 м». */
export function formatAltitude(lang: Lang, meters: number): string {
  return `${formatNumber(lang, Math.round(meters))}${NBSP}${UNIT.m[lang]}`;
}

/** «55 км/ч». */
export function formatSpeed(lang: Lang, kmh: number): string {
  return `${formatNumber(lang, Math.round(kmh))}${NBSP}${UNIT.kmh[lang]}`;
}

const MONTHS: Record<Lang, string[]> = {
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

interface Ymd { y: number; m: number; d: number }
const ymd = (epochMs: number): Ymd => {
  const dt = new Date(epochMs);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate() };
};

/** «12 мая 2024» / «12 May 2024». Дата берётся в UTC (stats.date уже сдвинута на местный пояс). */
export function formatDate(lang: Lang, epochMs: number): string {
  const { y, m, d } = ymd(epochMs);
  return `${d} ${MONTHS[lang][m]} ${y}`;
}

/** «1–12 мая 2024», «28 апреля – 12 мая 2024», «12 мая 2024 – 3 января 2025». */
export function formatDateRange(lang: Lang, from: number, to: number): string {
  const a = ymd(Math.min(from, to));
  const b = ymd(Math.max(from, to));
  const months = MONTHS[lang];
  if (a.y === b.y && a.m === b.m && a.d === b.d) return formatDate(lang, from);
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${months[a.m]} ${a.y}`;
  if (a.y === b.y) return `${a.d} ${months[a.m]} – ${b.d} ${months[b.m]} ${b.y}`;
  return `${a.d} ${months[a.m]} ${a.y} – ${b.d} ${months[b.m]} ${b.y}`;
}

export function countryName(lang: Lang, c: Country): string {
  return (lang === 'ru' ? c.nameRu || c.nameEn : c.nameEn || c.nameRu) || c.iso2;
}

export function placeName(lang: Lang, p: Place): string {
  return lang === 'ru' ? p.nameRu || p.nameEn : p.nameEn || p.nameRu;
}

export interface BeatTitleOptions {
  /** Подтверждённый маршрут по меткам: город у начала/конца только «рядом». */
  near?: boolean;
}

/** Заголовок карточки бита: «Старт — Трабзон», «Грузия», «Высшая точка — 2 400 м», «<остановка>», «Финиш — Хоргос». */
export function beatTitle(lang: Lang, beat: Beat, opts: BeatTitleOptions = {}): string {
  const withPlace = (key: 'beat.start' | 'beat.finish') => {
    const base = t(lang, key);
    const name = beat.place ? placeName(lang, beat.place) : '';
    if (!name) return base;
    return opts.near ? t(lang, key === 'beat.start' ? 'beat.startNearPlace' : 'beat.finishNearPlace', { place: name }) : `${base} — ${name}`;
  };
  switch (beat.kind) {
    case 'start': return withPlace('beat.start');
    case 'finish': return withPlace('beat.finish');
    case 'country': return beat.country ? countryName(lang, beat.country) : t(lang, 'label.country');
    case 'peak': {
      const base = t(lang, 'beat.peak');
      return beat.ele !== undefined ? `${base} — ${formatAltitude(lang, beat.ele)}` : base;
    }
    case 'waypoint': return beat.label || (beat.place ? placeName(lang, beat.place) : '') || '•';
  }
}

/** Подпись смены транспорта на маршруте по меткам: уницикл — предположение, неизвестный способ назван неизвестным. */
export function transportTitle(lang: Lang, change: Pick<TransportChange, 'kind'>): string {
  return t(lang, change.kind === 'train' ? 'transport.train' : change.kind === 'unicycle' ? 'transport.unicycle' : 'transport.unknownLeg');
}

/** Надзаголовок карточки смены транспорта: у участка с неизвестным способом — сама оговорка «способ неизвестен» (остаётся видимой). */
export function transportKicker(lang: Lang, change: Pick<TransportChange, 'kind'>): string {
  return t(lang, change.kind === 'unknown' ? 'transport.unknown' : 'transport.change');
}

export function sourceLabel(lang: Lang, source: CaptionSource): string { return t(lang, `source.${source}`); }
export function chapterCaption(lang: Lang, chapter: Chapter): { title: string; text: string; source: string } {
  return { title: chapter.title[lang], text: chapter.text[lang], source: sourceLabel(lang, chapter.source) };
}

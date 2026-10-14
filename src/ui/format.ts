// Форматирование чисел и дат для интерфейса приложения (по-русски). Тексты ролика — в src/i18n/.

const int = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatKm(meters: number): string {
  const km = meters / 1000;
  return `${(km < 100 ? oneDecimal : int).format(km)} км`;
}

export function formatInt(n: number): string {
  return int.format(n);
}

export function formatMeters(m: number): string {
  return `${int.format(Math.round(m))} м`;
}

export function formatDate(epochMs: number): string {
  return dateFmt.format(new Date(epochMs));
}

/** Склонение: plural(5, ['день', 'дня', 'дней']). */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

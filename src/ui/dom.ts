// Мини-помощник для создания DOM без фреймворка. Тексты — только через textContent (без innerHTML).

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** Иконка из статичной SVG-разметки (только наши константы, не пользовательский ввод). */
export function icon(name: keyof typeof ICONS, cls = 'icon'): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name];
  return span;
}

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

export const ICONS = {
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/></svg>',
  route: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="24" r="3"/><path d="M10 24h9a4.5 4.5 0 0 0 0-9h-6a4.5 4.5 0 0 1 0-9h9"/><path d="m24 3 3 3-3 3"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  check: `<svg viewBox="0 0 24 24" ${STROKE}><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>`,
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.2" height="14" rx="1.2"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2"/></svg>',
  restart: `<svg viewBox="0 0 24 24" ${STROKE}><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5v4.6h4.6"/></svg>`,
  chevron: `<svg viewBox="0 0 24 24" ${STROKE}><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>`,
  info: `<svg viewBox="0 0 24 24" ${STROKE}><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.7h.01"/></svg>`,
  image: `<svg viewBox="0 0 24 24" ${STROKE}><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="m4 16 4.5-4.5 4 4 3-3 4.5 4.5"/></svg>`,
} as const;

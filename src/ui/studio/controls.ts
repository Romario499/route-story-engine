// Элементы панели настроек: переключатель «один из», флажок, текстовое поле. Всё читает и пишет состояние через store.
import type { InfoKey } from '../../types';
import { h } from '../dom';
import type { AppState, Store } from '../state';
import { waypointInfoLabel } from '../waypoint-sample';

export interface Option<T> { value: T; label: string; sub?: string; testid: string }

/** Группа кнопок «один из»: выбранная — `aria-pressed="true"`, рамка и насыщенный шрифт (не только цвет). */
export function segmented<T extends string | number>(
  store: Store, label: string, options: Option<T>[], read: (s: AppState) => T, write: (v: T) => void,
): HTMLElement {
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', class: 'seg__btn', 'data-testid': o.testid, 'aria-pressed': 'false' },
      h('span', { class: 'seg__label', text: o.label }),
      o.sub ? h('span', { class: 'seg__sub', text: o.sub }) : null,
    );
    b.addEventListener('click', () => write(o.value));
    return b;
  });
  const sync = (s: AppState) => {
    const cur = read(s);
    options.forEach((o, i) => buttons[i].setAttribute('aria-pressed', String(o.value === cur)));
  };
  store.subscribe(sync);
  sync(store.get());
  return h('div', { class: 'field' },
    h('div', { class: 'field__label', text: label }),
    h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...buttons),
  );
}

export interface ToggleRow { row: HTMLElement; input: HTMLInputElement; hint: HTMLElement }

/** Флажок с подписью и необязательной пометкой справа. Отметка — галочка, а не только цвет. */
export function toggleRow(label: string, testid: string): ToggleRow {
  const input = h('input', { type: 'checkbox', 'data-testid': testid });
  const hint = h('span', { class: 'toggle__hint' });
  const row = h('label', { class: 'toggle' },
    input,
    h('span', { class: 'toggle__box', 'aria-hidden': 'true' }),
    h('span', { class: 'toggle__text', text: label }),
    hint,
  );
  return { row, input, hint };
}

export interface InfoItem { key: InfoKey; label: string; needs?: 'time' | 'ele'; estimatedOnSample?: boolean }

const NEEDS_HINT = { time: 'в файле нет времени', ele: 'в файле нет высоты' } as const;
export const ESTIMATED_HINT = 'расчётно';

/** Пометка справа от показателя: недоступен (нет данных в файле) или «расчётно» (у реконструкции). */
export function infoHint(item: InfoItem, state: AppState): { text: string; disabled: boolean } {
  const route = state.route;
  if (route?.source?.kind === 'waypoints') {
    if (['distance', 'speed', 'date', 'altitude', 'profile'].includes(item.key)) {
      return { text: 'нет GPS-трека', disabled: true };
    }
    if (item.key === 'day') {
      return route.journeyWaypoints?.some((p) => p.markedAt !== undefined)
        ? { text: '', disabled: false } : { text: 'у меток нет времени', disabled: true };
    }
    return { text: '', disabled: false };
  }
  const missing = route && item.needs && !(item.needs === 'time' ? route.hasTime : route.hasEle);
  if (missing && item.needs) return { text: NEEDS_HINT[item.needs], disabled: true };
  if (item.estimatedOnSample && state.source?.reconstruction) return { text: ESTIMATED_HINT, disabled: false };
  return { text: '', disabled: false };
}

/** Список показателей ролика: недоступные из-за файла — серые с причиной. */
export function infoToggles(store: Store, items: InfoItem[]): HTMLElement {
  const rows = items.map((item) => {
    const { row, input, hint } = toggleRow(item.label, `info-${item.key}`);
    const label = row.querySelector<HTMLElement>('.toggle__text')!;
    input.addEventListener('change', () => {
      store.updateSettings({ info: { ...store.get().settings.info, [item.key]: input.checked } });
    });
    const sync = (s: AppState) => {
      const info = infoHint(item, s);
      label.textContent = waypointInfoLabel(item.key, item.label, s.route);
      input.disabled = info.disabled;
      input.checked = !info.disabled && s.settings.info[item.key];
      row.classList.toggle('is-disabled', info.disabled);
      hint.textContent = info.text;
      if (info.disabled) row.title = `Недоступно: ${info.text}`; else row.removeAttribute('title');
    };
    store.subscribe(sync);
    sync(store.get());
    return row;
  });
  return h('div', { class: 'toggles' }, ...rows);
}

export function textField(
  store: Store, label: string, key: 'title' | 'author', placeholder: string, testid: string,
  placeholderFor?: (s: AppState) => string,
): { field: HTMLElement; input: HTMLInputElement } {
  const input = h('input', { type: 'text', class: 'input', placeholder, maxlength: 80, 'data-testid': testid, autocomplete: 'off' });
  if (placeholderFor) {
    const syncPlaceholder = (s: AppState) => { input.placeholder = placeholderFor(s) || placeholder; };
    store.subscribe(syncPlaceholder);
    syncPlaceholder(store.get());
  }
  input.value = store.get().settings[key];
  input.addEventListener('input', () => store.updateSettings({ [key]: input.value }));
  store.subscribe((s) => { if (document.activeElement !== input && input.value !== s.settings[key]) input.value = s.settings[key]; });
  const field = h('label', { class: 'field' }, h('span', { class: 'field__label', text: label }), input);
  return { field, input };
}

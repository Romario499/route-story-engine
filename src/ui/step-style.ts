// Настройки ролика: стиль и формат/длительность/язык (#step-style), текст и показатели с «Дополнительно» (#step-content).
// Оба контейнера замораживает панель экспорта.
import type { Format, StyleId } from '../types';
import { resolveTitle } from '../render/overlay';
import { STYLES } from '../render/styles';
import { t } from '../i18n';
import { h, icon } from './dom';
import type { AppState, Store } from './state';
import { infoToggles, segmented, textField, toggleRow, type InfoItem, type Option } from './studio/controls';
import { createDisclosure, createSection } from './studio/section';
import { titleFitIssue, titleFits, titleWarningText } from './studio/title-fit';

/** Снимки стилей: кадры рендера на примере @wahrier, снимает scripts/make-style-thumbs.mjs. */
export const styleThumbUrl = (id: StyleId): string => `./style-thumbs/${id}.webp`;

/** Образцы — кадры примера, а не трека пользователя: так и подписаны. */
export const STYLE_SAMPLE_CAPTION = 'пример стиля';

const MAIN_INFO: InfoItem[] = [
  { key: 'distance', label: 'Пройдено' },
  { key: 'progress', label: 'Прогресс' },
  { key: 'country', label: 'Страна и флаг' },
  { key: 'altitude', label: 'Высота', needs: 'ele' },
];

const MORE_INFO: InfoItem[] = [
  { key: 'day', label: 'День путешествия', needs: 'time', estimatedOnSample: true },
  { key: 'date', label: 'Дата', needs: 'time', estimatedOnSample: true },
  { key: 'speed', label: 'Скорость', needs: 'time', estimatedOnSample: true },
  { key: 'city', label: 'Ближайший город' },
  { key: 'profile', label: 'Профиль высот', needs: 'ele' },
];

function styleCards(store: Store): HTMLElement {
  const cards = (['epic', 'atlas', 'neon'] as const).map((id) => {
    const def = STYLES[id];
    const thumb = h('span', { class: 'style-card__thumb' });
    thumb.style.background = def.swatchCss; // запасной фон, пока (или если) снимок не загрузился
    const img = h('img', { src: styleThumbUrl(id), alt: '', width: 270, height: 480, loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    thumb.append(img, h('span', { class: 'style-card__check', 'aria-hidden': 'true' }, icon('check', 'icon')));
    const b = h('button', { type: 'button', class: 'style-card', 'data-testid': `style-${id}`, 'aria-pressed': 'false' },
      thumb,
      h('span', { class: 'style-card__name', text: t('ru', `style.${id}`) }),
      h('span', { class: 'style-card__cap', text: STYLE_SAMPLE_CAPTION }),
    );
    b.addEventListener('click', () => store.updateSettings({ styleId: id }));
    return { id, b };
  });
  const desc = h('p', { class: 'style-desc', 'aria-live': 'polite' });
  const sync = (s: AppState) => {
    cards.forEach(({ id, b }) => b.setAttribute('aria-pressed', String(s.settings.styleId === id)));
    desc.textContent = STYLES[s.settings.styleId].descriptionRu;
  };
  store.subscribe(sync);
  sync(store.get());
  return h('div', { class: 'style-step' },
    h('div', { class: 'style-cards', role: 'group', 'aria-label': 'Стиль ролика' }, ...cards.map((c) => c.b)),
    desc,
  );
}

function formatSection(store: Store): HTMLElement {
  const formats: Option<Format>[] = [
    { value: '9:16', label: '9:16', sub: 'Reels и Shorts', testid: 'format-9x16' },
    { value: '16:9', label: '16:9', sub: 'YouTube', testid: 'format-16x9' },
  ];
  const durations: Option<15 | 30 | 45 | 60>[] = ([15, 30, 45, 60] as const).map((v) => ({ value: v, label: `${v} с`, testid: `duration-${v}` }));
  const langs: Option<'ru' | 'en'>[] = [
    { value: 'ru', label: 'Русский', testid: 'lang-ru' },
    { value: 'en', label: 'English', testid: 'lang-en' },
  ];
  return h('div', { class: 'fields' },
    segmented(store, 'Формат', formats, (s) => s.settings.format, (v) => store.updateSettings({ format: v })),
    segmented(store, 'Длительность', durations, (s) => s.settings.durationSec, (v) => store.updateSettings({ durationSec: v })),
    segmented(store, 'Язык ролика', langs, (s) => s.settings.lang, (v) => store.updateSettings({ lang: v })),
  );
}

function titleWarning(store: Store): HTMLElement {
  const box = h('p', { class: 'field__warn', role: 'status', hidden: true, 'data-testid': 'title-warning' },
    icon('alert', 'icon'), h('span'));
  const text = box.querySelector('span')!;
  const sync = (s: AppState) => {
    const { lang, title, format, styleId } = s.settings;
    const issue = titleFitIssue(title, (c) => titleFits(lang, c, format, styleId));
    box.hidden = issue === null;
    text.textContent = issue ? titleWarningText(issue.maxChars) : '';
  };
  store.subscribe(sync);
  sync(store.get());
  return box;
}

function textSection(store: Store): HTMLElement {
  // пока поле пусто, в ролике стоит «<страна старта> → <страна финиша>» — показываем это как подсказку
  const title = textField(store, 'Заголовок', 'title', 'Название поездки', 'title-input',
    (s) => (s.route && s.enrichment ? `По умолчанию: ${resolveTitle(s.settings.lang, '', s.route, s.enrichment)}` : ''));
  const author = textField(store, 'Подпись автора', 'author', '@ваш_ник', 'author-input');
  return h('div', { class: 'fields' },
    h('div', { class: 'field-group' }, title.field, titleWarning(store)),
    author.field,
  );
}

function advancedSection(store: Store): HTMLElement {
  const safe = toggleRow('Показать безопасные зоны', 'safe-zones');
  safe.hint.textContent = 'только в просмотре';
  safe.input.addEventListener('change', () => store.updateSettings({ showSafeZones: safe.input.checked }));
  store.subscribe((s) => { safe.input.checked = s.settings.showSafeZones; });
  safe.input.checked = store.get().settings.showSafeZones;
  return h('div', { class: 'fields' },
    infoToggles(store, MORE_INFO),
    h('div', { class: 'toggles' }, safe.row),
  );
}

/** Контейнер `#step-style`: стиль → формат/длительность/язык (правая колонка студии). */
export function createStyleStep(store: Store): HTMLElement {
  return h('div', { class: 'settings-rest', id: 'step-style' },
    createSection({ id: 'section-style', title: 'Стиль', testid: 'section-style' }, styleCards(store)),
    createSection({ id: 'section-format', title: 'Формат и длительность', testid: 'section-format' }, formatSection(store)),
  );
}

/** Контейнер `#step-content`: элементы кадра, свёрнутый текст и дополнительные настройки справа. */
export function createContentStep(store: Store): HTMLElement {
  return h('div', { class: 'settings-rest', id: 'step-content' },
    createSection({ id: 'section-elements', title: 'Отображаемые элементы', testid: 'section-elements' }, infoToggles(store, MAIN_INFO)),
    createDisclosure({ id: 'section-text', title: 'Заголовок и автор', testid: 'section-text' }, textSection(store)),
    createDisclosure({ id: 'section-advanced', title: 'Дополнительно', testid: 'section-advanced' }, advancedSection(store)),
  );
}

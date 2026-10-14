// Секции панели настроек: заголовок + содержимое. Секция «Дополнительно» — свёртываемая (значения внутри сохраняются).
import { h, icon } from '../dom';

export interface SectionDef { id: string; title: string; testid: string }

/** Секция панели. `aside` — элемент справа от заголовка (например, статус загрузки). */
export function createSection(def: SectionDef, body: HTMLElement, aside?: HTMLElement): HTMLElement {
  const titleId = `${def.id}-title`;
  return h('section', { class: 'section', id: def.id, 'aria-labelledby': titleId, 'data-testid': def.testid },
    h('div', { class: 'section__head' },
      h('h2', { class: 'section__title', id: titleId, text: def.title }),
      aside,
    ),
    body,
  );
}

/** Свёртываемая группа. Содержимое остаётся в DOM, поэтому состояние полей не теряется при сворачивании. */
export function createDisclosure(def: SectionDef, body: HTMLElement): HTMLElement {
  const summary = h('summary', { class: 'disclosure__summary' },
    h('h2', { class: 'section__title', text: def.title }),
    icon('chevron', 'icon disclosure__chevron'),
  );
  return h('details', { class: 'section disclosure', id: def.id, 'data-testid': def.testid }, summary, body);
}

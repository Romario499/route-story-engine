// Каркас студии V3: маршрут, сцена, стиль и экспорт. Шаги — якоря одного экрана.
// ≥ 1024 px — три колонки; 820–1023 — сцена и одна боковая колонка;
// ≤ 819 — одна колонка: маршрут → сцена → стиль → текст → экспорт (липкая кнопка внизу).
// Порядок в DOM совпадает с визуальным в каждом режиме (Tab идёт по порядку на экране): блоки переезжают между колонками.
import { h, icon } from './dom';
import type { Store } from './state';
import { attachEnrichment } from './enrich';
import { createPreviewStep } from './step-preview';
import { createRouteStep } from './step-route';
import { createContentStep, createStyleStep } from './step-style';
import { SINGLE_COLUMN_QUERY, WIDE_QUERY } from './studio/frame-fit';

export type StudioLayout = 'wide' | 'side' | 'single';

export function mountApp(root: HTMLElement, store: Store): void {
  attachEnrichment(store);

  const steps = [
    { id: 'route', label: 'Маршрут', target: 'step-route' },
    { id: 'style', label: 'Стиль', target: 'section-style' },
    { id: 'scenes', label: 'Сцены', target: 'studio-scenes' },
    { id: 'export', label: 'Экспорт', target: 'export-slot' },
  ];
  let active = 'route';
  const navButtons = steps.map((step, i) => {
    const button = h('a', { class: 'nav-step', href: `#${step.target}`, 'data-testid': `nav-${step.id}` },
      h('span', { class: 'nav-step__number', text: String(i + 1), 'aria-hidden': 'true' }),
      h('span', { text: step.label }),
    );
    button.addEventListener('click', e => {
      e.preventDefault();
      active = step.id;
      syncNav();
      const target = document.getElementById(step.target);
      target?.scrollIntoView({ block: 'nearest' });
      target?.focus({ preventScroll: true });
    });
    return button;
  });
  function syncNav(): void {
    const state = store.get();
    navButtons.forEach((button, i) => {
      const ready = i === 0 ? !!state.route : i === 1 ? !!state.route : !!state.route && !!state.enrichment;
      button.dataset.ready = String(ready);
      button.setAttribute('aria-label', `${i + 1} ${steps[i].label} · ${ready ? 'готово' : 'ожидает маршрут'}`);
      if (steps[i].id === active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
  }
  store.subscribe(syncNav);
  syncNav();

  const header = h('header', { class: 'topbar' },
    h('div', { class: 'brand' },
      icon('route', 'icon brand__mark'),
      h('div', {},
        h('div', { class: 'brand__name' }, 'ROUTE ', h('strong', { text: 'STORY' })),
        h('div', { class: 'brand__sub', text: 'CINEMATIC ROUTE ENGINE' }),
      ),
    ),
    h('nav', { class: 'studio-nav', 'aria-label': 'Разделы студии' }, ...navButtons),
    h('div', { class: 'topbar__note' },
      h('span', { class: 'topbar__tagline', text: 'Из GPS-трека — в ролик для Reels, Shorts и YouTube' }),
      h('span', { class: 'topbar__privacy', text: 'Файлы не покидают браузер' }),
    ),
  );

  const route = createRouteStep(store);
  const style = createStyleStep(store);
  const content = createContentStep(store);
  const preview = createPreviewStep(store);

  const left = h('aside', { class: 'rail rail--left', 'aria-label': 'Маршрут и сведения' });
  const right = h('aside', { class: 'rail rail--right', 'aria-label': 'Стиль, формат и экспорт' });
  const settings = h('div', { class: 'rail-settings' });
  const stage = h('main', { class: 'stage', id: 'main' }, preview.view, preview.transport, preview.acts);
  const studio = h('div', { class: 'studio' }, left, stage, right);
  const identity = h('div', { class: 'studio-identity' },
    h('span', { class: 'studio-identity__eyebrow', text: 'CINEMATIC STUDIO' }),
    h('h1', { text: 'Студия путешествий' }),
    h('span', { class: 'studio-identity__hint', text: 'Ваш маршрут. Ваша история.' }),
  );
  studio.addEventListener('focusin', e => {
    const el = e.target as HTMLElement;
    const next = el.closest('#step-route') ? 'route' : el.closest('#export-slot') ? 'export'
      : el.closest('.stage') ? 'scenes' : el.closest('.rail--right') ? 'style' : active;
    if (active !== next) { active = next; syncNav(); }
  });

  const place = (layout: StudioLayout) => {
    studio.dataset.layout = layout;
    if (layout === 'wide') {
      left.replaceChildren(route);
      settings.replaceChildren(style, content);
      right.replaceChildren(settings, preview.slot);
    } else if (layout === 'side') {
      left.replaceChildren();
      settings.replaceChildren(route, style, content);
      right.replaceChildren(settings, preview.slot);
    } else {
      left.replaceChildren(route);
      settings.replaceChildren(style, content);
      right.replaceChildren(settings);
      studio.append(preview.slot); // липкая кнопка экспорта — прямой потомок студии, чтобы держаться у нижнего края окна
    }
    left.hidden = layout === 'side';
  };
  const layoutNow = (): StudioLayout =>
    window.matchMedia(WIDE_QUERY).matches ? 'wide' : window.matchMedia(SINGLE_COLUMN_QUERY).matches ? 'single' : 'side';
  for (const q of [WIDE_QUERY, SINGLE_COLUMN_QUERY]) window.matchMedia(q).addEventListener('change', () => place(layoutNow()));

  root.replaceChildren(header, identity, studio);
  place(layoutNow());
  for (const step of steps) document.getElementById(step.target)?.setAttribute('tabindex', '-1');
}

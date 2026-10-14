import { journeyFacts, isWaypointRoute } from '../../story';
import { h, icon } from '../dom';
import { formatInt, formatKm, formatMeters } from '../format';
import type { AppState } from '../state';

/** Только доступные факты. Метки и реконструкция не получают статистику GPS-записи. */
export function routeFactsView(state: AppState): HTMLElement {
  const { route, enrichment } = state;
  const view = h('div', { class: 'route-facts', 'data-testid': 'route-facts' });
  if (!route) return view;
  const marks = isWaypointRoute(route);
  const reconstructed = state.source?.reconstruction === true;
  const values: { value: string; label: string; symbol: 'route' | 'info' | 'file' }[] = [];
  if (marks) {
    values.push({ value: formatInt(route.points.length), label: 'Меток', symbol: 'route' });
    values.push({ value: formatInt(journeyFacts(route)?.nightsTotal ?? 0), label: 'Мест ночёвок', symbol: 'info' });
  } else {
    values.push({ value: formatKm(route.totalM).replace(' км', ''), label: reconstructed ? 'км · по реконструкции' : 'км · по треку', symbol: 'route' });
    if (!reconstructed && route.hasTime && route.days !== undefined) values.push({ value: formatInt(route.days), label: 'Дней по треку', symbol: 'info' });
    else values.push({ value: formatInt(route.points.length), label: 'Точек', symbol: 'file' });
  }
  if (enrichment) values.push({ value: formatInt(enrichment.countries.length), label: 'Стран', symbol: 'info' });
  if (marks) values.push({ value: route.waypointOrderConfirmed ? 'Порядок' : 'Обзор', label: route.waypointOrderConfirmed ? 'Подтверждён вами' : 'Без хронологии', symbol: 'file' });
  else if (!reconstructed && route.hasEle && route.maxEle) values.push({ value: formatMeters(route.maxEle.value), label: 'Высшая точка', symbol: 'info' });
  const grid = h('div', { class: 'route-metrics' }, ...values.map(item => h('div', { class: 'route-metric' },
    icon(item.symbol, 'icon'), h('strong', { text: item.value }), h('span', { text: item.label }),
  )));
  view.append(h('div', { class: 'route-facts__title', text: 'Сведения о маршруте' }), grid);
  if (!marks && !reconstructed && route.hasEle) {
    const points = route.points.filter(p => p.ele !== undefined && Number.isFinite(p.ele));
    if (points.length >= 2) {
      const elevations = points.map(p => p.ele!);
      const min = elevations.reduce((a, b) => Math.min(a, b), Infinity);
      const max = elevations.reduce((a, b) => Math.max(a, b), -Infinity);
      const canvas = h('canvas', { class: 'route-profile', width: 500, height: 112, role: 'img', 'aria-label': `Профиль высоты: ${formatMeters(min)} — ${formatMeters(max)}`, 'data-testid': 'route-profile' });
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const x = (i: number) => 8 + (route.totalM > 0 ? points[i].d / route.totalM : i / (points.length - 1)) * 484;
        const y = (i: number) => 96 - (elevations[i] - min) / (max - min || 1) * 80;
        ctx.beginPath(); ctx.moveTo(x(0), 104);
        points.forEach((_, i) => ctx.lineTo(x(i), y(i)));
        ctx.lineTo(x(points.length - 1), 104); ctx.closePath();
        const fill = ctx.createLinearGradient(0, 0, 0, 112);
        fill.addColorStop(0, '#ffc24e55'); fill.addColorStop(1, '#ffc24e00');
        ctx.fillStyle = fill; ctx.fill(); ctx.beginPath();
        points.forEach((_, i) => { if (i === 0) ctx.moveTo(x(i), y(i)); else ctx.lineTo(x(i), y(i)); });
        ctx.strokeStyle = '#ffc24e'; ctx.lineWidth = 2; ctx.stroke();
      }
      view.append(canvas, h('span', { class: 'route-profile__label', text: `${formatMeters(min)} — ${formatMeters(max)} · профиль высоты` }));
    }
  }
  return view;
}

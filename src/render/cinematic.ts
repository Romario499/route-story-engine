import { countryName, formatAltitude, placeName, t } from '../i18n';
import { isWaypointRoute } from '../story/legs';
import type { Enrichment, FrameState, Route, StorySettings } from '../types';
import { placeCallout } from './callouts';
import { FONT_FAMILIES } from './fonts';
import { overlayAttributionRect, overlayChapterRect, overlayChapterReserve, overlayTitleBottom } from './overlay';
import { layoutFor, type Rect } from './layout';
import type { StyleDef } from './styles';
import type { Project, TrackModel } from './track';

/** Один буфер на сцену, половинное разрешение; карта размывается, линия и текст остаются чёткими. */
export function applyTiltShift(ctx: CanvasRenderingContext2D, buffer: HTMLCanvasElement, pitch: number, focus: number): void {
  if (pitch < 0.02 || focus < 0.05) return;
  const { width: w, height: h } = ctx.canvas;
  const bw = Math.round(w / 2), bh = Math.round(h / 2);
  if (buffer.width !== bw || buffer.height !== bh) { buffer.width = bw; buffer.height = bh; }
  const g = buffer.getContext('2d')!;
  g.clearRect(0, 0, bw, bh);
  g.filter = `blur(${Math.min(w, h) / 450}px)`;
  g.drawImage(ctx.canvas, 0, 0, bw, bh);
  g.filter = 'none';
  const mask = g.createLinearGradient(0, 0, 0, bh);
  mask.addColorStop(0, 'rgba(0,0,0,0.95)');
  mask.addColorStop(0.24, 'rgba(0,0,0,0.25)');
  mask.addColorStop(0.38, 'rgba(0,0,0,0)');
  mask.addColorStop(0.68, 'rgba(0,0,0,0)');
  mask.addColorStop(0.86, 'rgba(0,0,0,0.3)');
  mask.addColorStop(1, 'rgba(0,0,0,0.85)');
  g.globalCompositeOperation = 'destination-in'; g.fillStyle = mask; g.fillRect(0, 0, bw, bh);
  g.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.globalAlpha = Math.min(0.22, pitch * focus * 0.22);
  ctx.drawImage(buffer, 0, 0, w, h); ctx.restore();
}

export function drawCinematicGeography(ctx: CanvasRenderingContext2D, frame: FrameState, route: Route,
  enrichment: Enrichment, settings: StorySettings, style: StyleDef, project: Project, model: TrackModel,
  dem: boolean, reconstruction: boolean, terrainScale = 1): void {
  if (!frame.shot) return;
  const l = layoutFor(settings.format, style.id), lang = settings.lang;
  const sizes = l.readability;
  const mark = isWaypointRoute(route), overview = mark && !route.waypointOrderConfirmed;
  ctx.save();
  ctx.font = `500 ${sizes.legendSize}px '${FONT_FAMILIES.mono}', monospace`;
  ctx.textBaseline = 'alphabetic';
  const source = t(lang, mark ? 'film.marks' : reconstruction ? 'film.reconstruction' : 'film.recorded');
  const terrain = dem ? `${t(lang, 'film.dem')} ×${terrainScale.toFixed(2)}` : t(lang, 'film.flat');
  const trust = `${source} · ${terrain}`;
  const data = { route, enrichment, settings, style, reconstruction };
  const chapter = overlayChapterRect(ctx, frame, data);
  const reserve = overlayChapterReserve(ctx, frame, data);
  const ty = Math.max(frame.act === 'journey' ? l.caption.y + l.caption.h + 56 :
    overlayTitleBottom(ctx, frame, data) + 46, reserve ? reserve.y + reserve.h + 46 : 0);
  const legendTop = ty - sizes.legendSize - 4;
  // В широком кадре оставляем колонку показателей/итогов свободной, в вертикальном — рабочую ширину.
  const maxLegendWidth = settings.format === '16:9'
    ? (frame.act === 'outro' ? l.summary.x : l.stats.x) - l.work.x - 20 : l.work.w;
  const legend = { x: l.work.x, y: legendTop, w: Math.min(maxLegendWidth, ctx.measureText(trust).width + 24), h: sizes.legendHeight };
  ctx.fillStyle = style.palette.cardBg; ctx.fillRect(legend.x, legend.y, legend.w, legend.h);
  ctx.fillStyle = style.palette.text; ctx.fillText(trust, legend.x + 10, ty, legend.w - 24);
  if (overview) { ctx.restore(); return; } // Подписи T24; нумерация не создаёт хронологию меток.
  // Настоящая координата из файла, без интерполяции между сегментами.
  const idx = frame.act === 'intro' ? 0 : frame.act === 'outro' ? route.points.length - 1 : Math.floor(frame.head);
  const p = route.points[idx], anchor = project(p.lon, p.lat);
  const point = { x: anchor.x * 2, y: anchor.y * 2 };
  if (point.x < l.work.x || point.y < l.work.y || point.x > l.work.x + l.work.w || point.y > l.work.y + l.work.h) {
    ctx.restore(); return;
  }
  const place = enrichment.placeAt(idx), country = enrichment.countryAt(idx);
  const title = frame.act === 'outro' ? t(lang, 'film.lastPoint') : place ?
    `${t(lang, 'label.city')}: ${placeName(lang, place)}` : country ? countryName(lang, country) : t(lang, 'film.coordinate');
  const coords = `${p.lat.toFixed(4)}° / ${p.lon.toFixed(4)}°`;
  const detail = !mark && p.ele !== undefined && Number.isFinite(p.ele) ?
    `${coords} · ${formatAltitude(lang, p.ele)}` : coords;
  ctx.font = `600 ${sizes.calloutTitle}px ${style.fonts.label}`;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = `500 ${sizes.calloutDetail}px '${FONT_FAMILIES.mono}', monospace`;
  const detailWidth = ctx.measureText(detail).width;
  const w = Math.min(l.work.w, settings.format === '16:9' ? Math.max(titleWidth + 68, detailWidth + 32) :
    Math.max(titleWidth, detailWidth) + 88), h = sizes.calloutHeight;
  const segments: [number, number, number, number][] = [];
  for (let k = 1; k < model.n; k++) {
    if (model.transferSeg[k - 1] || !model.have[k - 1] || !model.have[k]) continue;
    segments.push([model.sx[k - 1] * 2, model.sy[k - 1] * 2, model.sx[k] * 2, model.sy[k] * 2]);
  }
  const reserved: Rect[] = [chapter ?? l.caption, l.stats, l.profile,
    ...(model.labelBoxes ?? []).map(r => ({ x: r.x * 2, y: r.y * 2, w: r.w * 2, h: r.h * 2 })),
    { x: l.work.x, y: legendTop, w: l.work.w, h: sizes.legendHeight },
    overlayAttributionRect(ctx, frame, { route, enrichment, settings, style, reconstruction }),
    ...(frame.act !== 'journey' ? [l.title, l.summary] : [])];
  const bounds = frame.act !== 'journey' && l.summaryDock === 'right' ?
    { ...l.work, w: l.summary.x - 20 - l.work.x } : l.work;
  const box = placeCallout(point, bounds, w, h, reserved, segments);
  if (box) {
    const x = Math.max(box.x, Math.min(box.x + box.w, point.x));
    const y = Math.max(box.y, Math.min(box.y + box.h, point.y));
    ctx.strokeStyle = style.palette.accent; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = style.palette.cardBg; ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.beginPath(); ctx.arc(box.x + 28, box.y + 30, 17, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = style.palette.text; ctx.font = `500 18px '${FONT_FAMILIES.mono}', monospace`;
    ctx.textAlign = 'center'; ctx.fillText(String(frame.shot.number).padStart(2, '0'), box.x + 28, box.y + 36);
    ctx.textAlign = 'left'; ctx.font = `600 ${sizes.calloutTitle}px ${style.fonts.label}`;
    ctx.fillText(title, box.x + 56, box.y + 37 + (sizes.calloutTitle - 28), box.w - 68);
    ctx.font = `500 ${sizes.calloutDetail}px '${FONT_FAMILIES.mono}', monospace`;
    ctx.fillStyle = style.palette.secondary; ctx.fillText(detail, box.x + 16, box.y + h - 20, box.w - 32);
  }
  ctx.restore();
}

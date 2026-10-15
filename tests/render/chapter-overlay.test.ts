import { expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import { drawOverlay, overlayChapterRect } from '../../src/render/overlay';
import { drawCinematicGeography } from '../../src/render/cinematic';
import { layoutFor, timelineOptionsFor, type Rect } from '../../src/render/layout';
import { prepareTrack } from '../../src/render/track';
import * as styles from '../../src/render/styles';
import { t } from '../../src/i18n';
import { enrichmentFor, settings } from '../story/fixtures';
import { jw, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';
import type { Chapter } from '../../src/types';
const chapter: Chapter = { id:'fiction',title:{ru:'Придуманная глава',en:'Fictional chapter'},text:{ru:'Вымышленная история.',en:'A fictional story.'},source:'traveler',mood:'cold',anchor:{countries:['GE']} };
it('компактная страна и глава видны одновременно RU/EN в обоих форматах; финал без сравнений', () => {
  const route = waypointRoute(Array.from({length:16},(_,i)=>jw(40,30+i*0.3,'overnight',i)));
  route.chapters=[chapter,{...chapter,id:'warm',mood:'warmth',anchor:{countries:['AM']}},{...chapter,id:'final',finale:true}];
  const env=enrichmentFor(route);
  for (const format of ['9:16','16:9'] as const) for(const styleId of ['epic','atlas'] as const) for(const lang of ['ru','en'] as const) {
    const cfg=settings({format,styleId,lang}),tl=buildTimeline(route,env,cfg);
    const frames=Array.from({length:901},(_,i)=>tl.frameAt(i/30));
    expect(frames[300].chapterMood).toBeDefined();
    const tones=frames.map(f=>styles.chapterToneFor(styleId,f.chapterMood));
    expect(Math.max(...tones.map(x=>x.strength))).toBeGreaterThan(0);
    for(let i=1;i<tones.length;i++) for(let k=0;k<3;k++) expect(Math.abs(tones[i].rgb[k]*tones[i].strength-tones[i-1].rgb[k]*tones[i-1].strength)).toBeLessThan(2);
    const frame=frames.find(f=>f.cards[0]?.chapter?.id==='fiction' && f.cards[0].alpha===1)!;
    const rec=recorder();
    rec.ctx.fillRect = (x, y, w, h) => rec.fills.push({ x, y, w, h, alpha: rec.ctx.globalAlpha });
    drawOverlay(rec.ctx,frame,{route,enrichment:env,settings:cfg,style:styles.STYLES[styleId],reconstruction:false});
    expect(rec.texts.join(' ')).toContain(chapter.title[lang]);
    expect(rec.texts.join(' ')).toContain(chapter.text[lang]);
    expect(rec.texts.join(' ')).toContain(t(lang,'source.traveler'));
    const countryName = lang === 'ru' ? 'Грузия' : 'Georgia';
    expect(rec.texts).toContain(countryName);
    const countryRects = rec.textRects.filter(r => r.text === countryName);
    const chapterRects = rec.textRects.filter(r => [chapter.title[lang], chapter.text[lang], t(lang, 'source.traveler')].includes(r.text));
    for (const caption of chapterRects) {
      expect(rec.fills.some(r => r.x <= caption.x && r.y <= caption.y
        && r.x + r.w >= caption.x + caption.w && r.y + r.h >= caption.y + caption.h)).toBe(true);
    }
    for (const country of countryRects) for (const caption of chapterRects) {
      expect(caption.y).toBeGreaterThan(country.y + country.h + 12);
    }
    const fin=recorder();drawOverlay(fin.ctx,tl.frameAt(30),{route,enrichment:env,settings:cfg,style:styles.STYLES[styleId],reconstruction:false});
    expect(fin.texts.join(' ')).toContain(chapter.text[lang]);
    for(const r of rec.textRects) if([chapter.title[lang],chapter.text[lang],t(lang,'source.traveler')].includes(r.text)) { expect(r.x+r.w).toBeLessThanOrEqual(format==='9:16'?900:1824); expect(r.y).toBeGreaterThanOrEqual(format==='9:16'?240:72); }
  }
  expect(t('ru','source.gps')).toBe('GPS-трек');expect(t('en','source.organic-maps')).toContain('Organic Maps');
});

it('при появлении главы служебная подпись меток уже погасла', () => {
  const route = waypointRoute(Array.from({ length: 16 }, (_, i) => jw(40, 30 + i * 0.3, 'overnight', i)));
  route.chapters = [chapter];
  const env = enrichmentFor(route), cfg = settings(), tl = buildTimeline(route, env, cfg);
  const frame = Array.from({ length: 901 }, (_, i) => tl.frameAt(i / 30)).find(f => f.cards[0]?.chapter && f.cards[0].alpha > 0.5 && f.cards[0].alpha < 0.9)!;
  const rec = recorder();
  drawOverlay(rec.ctx, frame, { route, enrichment: env, settings: cfg, style: styles.STYLES.epic, reconstruction: false });
  expect(rec.texts.join(' ')).toContain(chapter.title.ru);
  expect(rec.texts).not.toContain(t('ru', 'note.waypoints'));
});

it('перекрывающиеся географические главы переключают атмосферу по текущему титру', () => {
  const route = waypointRoute(Array.from({ length: 16 }, (_, i) => jw(40, 30 + i * 0.3, 'overnight', i)));
  route.chapters = [chapter, { ...chapter, id: 'thanks', mood: 'warmth' }];
  const env = enrichmentFor(route, { border: 16 }), tl = buildTimeline(route, env, settings());
  const frame = Array.from({ length: 901 }, (_, i) => tl.frameAt(i / 30)).find(f => f.cards[0]?.chapter?.id === 'thanks' && f.cards[0].alpha === 1)!;
  expect(frame).toBeDefined();
  expect(tl.frameAt(frame.t + 1).chapterMood?.weights.warmth).toBeGreaterThan(0.99);
});

it.each(['9:16', '16:9'] as const)('%s: многострочная глава и DEM-легенда не пересекаются и оставляют показатели свободными', format => {
  const multiline: Chapter = {
    ...chapter,
    id: 'long-fiction',
    title: { ru: 'Вымышленная экспедиция через долины и высокие горные перевалы', en: 'Fictional expedition through valleys and high mountain passes' },
    text: { ru: 'Утром герои собирают лагерь. После короткой остановки они продолжают путь по долине и встречают вечер у небольшого озера.', en: 'The fictional travelers pack their camp and continue through the valley after a short stop, reaching a small lake in the evening.' },
  };
  const route = waypointRoute(Array.from({ length: 16 }, (_, i) => jw(40, 30 + i * 0.3, 'overnight', i)));
  route.chapters = [chapter, multiline, { ...multiline, id: 'final', finale: true }];
  const enrichment = enrichmentFor(route), cfg = settings({ format, durationSec: 60 }), style = styles.STYLES.epic;
  const tl = buildTimeline(route, enrichment, cfg, timelineOptionsFor(format, style.id));
  const frames = Array.from({ length: 1801 }, (_, i) => tl.frameAt(i / 30));
  const full = frames.find(f => f.act === 'journey' && f.cards[0]?.chapter === multiline && f.cards[0].alpha === 1)!;
  const entering = frames.find(f => f.act === 'journey' && f.cards[0]?.chapter === multiline && f.cards[0].alpha > 0.5 && f.cards[0].alpha < 0.9)!;
  expect(full).toBeDefined(); expect(entering).toBeDefined();
  for (const frame of [entering, full, tl.frameAt(60)]) {
    const data = { route, enrichment, settings: cfg, style, reconstruction: false };
    const overlay = recorder();
    drawOverlay(overlay.ctx, frame, data);
    const caption = overlayChapterRect(overlay.ctx, frame, data)!;
    expect(caption).not.toBeNull();
    const chapterTexts = overlay.textRects.filter(r => r.x === caption.x && r.y >= caption.y && r.y < caption.y + caption.h);
    expect(chapterTexts.length).toBeGreaterThanOrEqual(5); // источник + переносы заголовка и текста
    expect(chapterTexts.map(r => r.text).join(' ')).toContain(multiline.text.ru);
    const geography = recorder();
    const rectangles: Rect[] = [];
    geography.ctx.fillRect = (x, y, w, h) => { rectangles.push({ x, y, w, h }); };
    drawCinematicGeography(geography.ctx, frame, route, enrichment, cfg, style,
      () => ({ x: -100, y: -100 }), prepareTrack(route), true, false);
    const legend = rectangles[0], l = layoutFor(format);
    expect(geography.texts[0]).toContain(t('ru', 'film.marks'));
    expect(geography.texts[0]).toContain(t('ru', 'film.dem'));
    for (const r of [caption, ...chapterTexts]) {
      expect(r.x < legend.x + legend.w && legend.x < r.x + r.w
        && r.y < legend.y + legend.h && legend.y < r.y + r.h).toBe(false);
      expect(legend.y).toBeGreaterThan(r.y + r.h);
    }
    expect(legend.x).toBeGreaterThanOrEqual(l.work.x);
    expect(legend.x + legend.w).toBeLessThanOrEqual(l.work.x + l.work.w);
    expect(legend.y).toBeGreaterThanOrEqual(l.work.y);
    expect(legend.y + legend.h).toBeLessThanOrEqual(l.work.y + l.work.h);
    if (format === '9:16') expect(legend.y + legend.h).toBeLessThan(l.stats.y);
    else expect(legend.x + legend.w).toBeLessThan(frame.act === 'outro' ? l.summary.x : l.stats.x);
  }
  const withoutChapter = { ...full, cards: [] };
  expect(overlayChapterRect(recorder().ctx, withoutChapter,
    { route, enrichment, settings: cfg, style, reconstruction: false })).toBeNull();

  const data = { route, enrichment, settings: cfg, style, reconstruction: false };
  const geography = recorder(), model = prepareTrack(route);
  const ys = { journey: new Set<number>(), outro: new Set<number>() };
  const phases = new Set<string>();
  const shownChapters = new Set<string>();
  let legend: Rect | undefined;
  // Geography draws the legend first, then may draw a callout background.
  geography.ctx.fillRect = (x, y, w, h) => { legend ??= { x, y, w, h }; };
  for (const frame of frames) {
    if (frame.act === 'intro') continue;
    legend = undefined;
    drawCinematicGeography(geography.ctx, frame, route, enrichment, cfg, style,
      () => ({ x: -100, y: -100 }), model, true, false);
    ys[frame.act].add(legend!.y);
    const caption = overlayChapterRect(geography.ctx, frame, data);
    if (caption) {
      expect(legend!.y).toBeGreaterThan(caption.y + caption.h);
      if (frame.cards[0]?.chapter) shownChapters.add(frame.cards[0].chapter.id);
    }
    if (frame.act === 'journey') phases.add(frame.t < entering.t ? 'before' : frame.t <= full.t ? 'during' : 'after');
  }
  expect(phases.size).toBe(3);
  expect(shownChapters).toEqual(new Set([chapter.id, multiline.id]));
  expect(ys.journey.size).toBe(1); // включая кадры с пустым слотом и обе стороны порога SLOT_SPLIT
  expect(ys.outro.size).toBe(1); // включая полностью прозрачный финальный титр
});

it('границы главы используют пороги рисования и кеш геометрии с отдельными ключами', () => {
  const route = waypointRoute(Array.from({ length: 16 }, (_, i) => jw(40, 30 + i * 0.3, 'overnight', i)));
  const ownChapter = { ...chapter };
  route.chapters = [ownChapter];
  const enrichment = enrichmentFor(route), cfg = settings({ durationSec: 60 }), style = styles.STYLES.epic;
  const tl = buildTimeline(route, enrichment, cfg, timelineOptionsFor(cfg.format, style.id));
  const frame = Array.from({ length: 1801 }, (_, i) => tl.frameAt(i / 30)).find(f => f.cards[0]?.chapter && f.cards[0].alpha === 1)!;
  const rec = recorder(), data = { route, enrichment, settings: cfg, style, reconstruction: false };
  const measure = rec.ctx.measureText.bind(rec.ctx);
  let measures = 0;
  rec.ctx.measureText = str => { measures++; return measure(str); };
  const first = overlayChapterRect(rec.ctx, frame, data);
  expect(measures).toBeGreaterThan(0);
  const initial = measures;
  expect(overlayChapterRect(rec.ctx, { ...frame, t: frame.t + 0.01 }, data)).toBe(first);
  expect(measures).toBe(initial);
  for (const alpha of [0, 0.2, 0.35, 0.36]) {
    expect(overlayChapterRect(rec.ctx, { ...frame, cards: [{ ...frame.cards[0], alpha }] }, data)).toBeNull();
  }
  expect(overlayChapterRect(rec.ctx, { ...frame, t: 0 }, data)).toBeNull();
  for (const changes of [{ format: '16:9' as const }, { lang: 'en' as const }]) {
    const before = measures;
    expect(overlayChapterRect(rec.ctx, frame, { ...data, settings: { ...cfg, ...changes } })).not.toBeNull();
    expect(measures).toBeGreaterThan(before);
  }
  const before = measures;
  rec.ctx.scale(0.5, 0.5);
  expect(overlayChapterRect(rec.ctx, frame, data)).not.toBeNull();
  expect(measures).toBeGreaterThan(before);
});


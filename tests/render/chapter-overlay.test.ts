import { expect, it } from 'vitest';
import { buildTimeline } from '../../src/story';
import { drawOverlay } from '../../src/render/overlay';
import * as styles from '../../src/render/styles';
import { t } from '../../src/i18n';
import { enrichmentFor, settings } from '../story/fixtures';
import { jw, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';
import type { Chapter } from '../../src/types';
const chapter: Chapter = { id:'fiction',title:{ru:'Придуманная глава',en:'Fictional chapter'},text:{ru:'Вымышленная история.',en:'A fictional story.'},source:'traveler',mood:'cold',anchor:{countries:['GE']} };
it('глава рисует титр, краткий текст и источник RU/EN в одном слоте, тон плавный в обоих стилях, финал без сравнений', () => {
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
    drawOverlay(rec.ctx,frame,{route,enrichment:env,settings:cfg,style:styles.STYLES[styleId],reconstruction:false});
    expect(rec.texts.join(' ')).toContain(chapter.title[lang]);
    expect(rec.texts.join(' ')).toContain(chapter.text[lang]);
    expect(rec.texts.join(' ')).toContain(t(lang,'source.traveler'));
    expect(rec.texts.join(' ')).not.toContain(lang==='ru'?'Грузия':'Georgia');
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


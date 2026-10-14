// Ремонт ветки F3 (G90): у маршрута по меткам город у старта/финиша — только «рядом» (близость огрублённой метки
// к городу в радиусе PLACE_RADIUS_KM не доказывает старт в нём). У GPX подписи прежние.
import { describe, expect, it } from 'vitest';
import { beatTitle } from '../../src/i18n';
import { timelineOptionsFor } from '../../src/render/layout';
import { beatCaption, drawOverlay } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { drawTrackLayer, prepareTrack } from '../../src/render/track';
import { buildTimeline } from '../../src/story';
import { FPS, MAP_VIEWPORT, type Lang } from '../../src/types';
import { enrichmentFor, lineRoute, settings } from '../story/fixtures';
import { jw, confirmedWaypointRoute as waypointRoute } from '../story/waypoint-fixtures';
import { recorder } from './overlay-recorder';

const route = waypointRoute(Array.from({ length: 8 }, (_, i) => jw(41, 40 + i * 0.5, 'overnight', i)));
// найденные города: Тбилиси у старта, Ереван у финиша (как отдаёт enrichRoute при городе в радиусе 40 км)
const enrichment = enrichmentFor(route, { border: 4 });
const CITY: Record<Lang, [string, string]> = { ru: ['Тбилиси', 'Ереван'], en: ['Tbilisi', 'Yerevan'] };
const ENDS: Record<Lang, RegExp> = { ru: /^(старт|финиш)/i, en: /^(start|finish)/i };
const NEAR: Record<Lang, RegExp> = { ru: /рядом/i, en: /near/i };

describe('маршрут по меткам: старт и финиш «рядом с», а не «в» городе', () => {
  it('подписи на карте: нет «Старт — X», есть «рядом» с найденным городом (RU/EN)', () => {
    for (const lang of ['ru', 'en'] as Lang[]) {
      const tl = buildTimeline(route, enrichment, settings({ lang }));
      const rec = recorder();
      drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment, lang,
        frame: tl.frameAt(tl.durationSec), style: STYLES.epic, view: MAP_VIEWPORT['9:16'],
        project: (lon) => ({ x: 60 + (lon - 40) * 100, y: 480 }),
      });
      const [start, finish] = CITY[lang];
      const ends = rec.texts.filter((s) => ENDS[lang].test(s));
      expect(ends, lang).toHaveLength(2);
      for (const s of ends) {
        expect(s).not.toMatch(/ — /);
        expect(s).toMatch(NEAR[lang]);
      }
      expect(ends.some((s) => s.includes(start))).toBe(true);
      expect(ends.some((s) => s.includes(finish))).toBe(true);
    }
  });

  it('карточка старта/финиша в кадре: надзаголовок «рядом», ни одного кадра «Старт» + город без оговорки', () => {
    for (const lang of ['ru', 'en'] as Lang[]) for (const format of ['9:16', '16:9'] as const) {
      const s = settings({ lang, format, title: lang === 'ru' ? 'Тест' : 'Test' });
      const tl = buildTimeline(route, enrichment, s, timelineOptionsFor(format));
      let endCards = 0;
      for (let i = 0; i <= tl.frameCount; i++) {
        const f = tl.frameAt(i / FPS);
        const end = f.cards.find((c) => !c.transport && !c.chapter && (c.beat.kind === 'start' || c.beat.kind === 'finish'));
        if (!end || end.alpha < 0.4) continue; // карточка рисуется, когда её доля слота больше SLOT_SPLIT (0,35)
        const rec = recorder();
        drawOverlay(rec.ctx, f, { route, enrichment, settings: s, style: STYLES.epic, reconstruction: false });
        const kickers = rec.texts.filter((x) => ENDS[lang].test(x));
        expect(kickers.length, `${lang} ${format} t=${f.t}`).toBeGreaterThan(0);
        for (const k of kickers) expect(k, `${lang} ${format} t=${f.t}`).toMatch(NEAR[lang]);
        endCards++;
      }
      expect(endCards, `${lang} ${format}`).toBeGreaterThan(0);
    }
    expect(beatCaption('ru', enrichment.beats[0], route)).toEqual({ kicker: 'Старт · рядом', title: 'Тбилиси' });
    expect(beatCaption('en', enrichment.beats.at(-1)!, route)).toEqual({ kicker: 'Finish · near', title: 'Yerevan' });
  });

  it('внутри главы источник не стирает оговорку «рядом» у старта по меткам', () => {
    const s = settings({ title: 'Тест' });
    const tl = buildTimeline(route, enrichment, s, timelineOptionsFor('9:16'));
    const f = Array.from({ length: tl.frameCount + 1 }, (_, i) => tl.frameAt(i / FPS))
      .find((x) => x.cards.some((c) => c.beat.kind === 'start' && c.alpha > 0.9))!;
    expect(f).toBeDefined();
    const weights = { cold: 1, heat: 0, rain: 0, altitude: 0, warmth: 0, neutral: 0 };
    const rec = recorder();
    drawOverlay(rec.ctx, { ...f, chapterMood: { weights } }, { route, enrichment, settings: s, style: STYLES.epic, reconstruction: false });
    expect(rec.texts.some((x) => /^старт · рядом$/i.test(x))).toBe(true);
    expect(rec.texts).toContain('Тбилиси');
  });

  it('без найденного города у меток — просто «Старт»/«Финиш», без «рядом»', () => {
    const start = { kind: 'start' as const, idx: 0, place: null };
    expect(beatTitle('ru', start, { near: true })).toBe('Старт');
    expect(beatCaption('en', { ...start, kind: 'finish' }, route)).toEqual({ title: 'Finish' });
  });

  it('GPX без изменений: «Старт — Тбилиси», надзаголовок «Старт»', () => {
    const gpx = lineRoute(50);
    const e = enrichmentFor(gpx);
    expect(beatTitle('ru', e.beats[0])).toBe('Старт — Тбилиси');
    expect(beatCaption('ru', e.beats[0], gpx)).toEqual({ kicker: 'Старт', title: 'Тбилиси' });
    expect(beatCaption('en', e.beats.at(-1)!, gpx)).toEqual({ kicker: 'Finish', title: 'Yerevan' });
  });
});

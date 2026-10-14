// Подписи старта и финиша рисует слой трека (track.ts), но их место — в рабочей зоне оформления (истории 82–83):
// на общем плане (интро и финал) самая широкая подпись не должна выходить за рабочую зону и лезть под итоги.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import type { CountriesJson, PlacesJson } from '../../src/geo';
import { beatTitle } from '../../src/i18n';
import { layoutFor, timelineOptionsFor, WORK_AREA } from '../../src/render/layout';
import { STYLES } from '../../src/render/styles';
import { drawTrackLayer, prepareTrack } from '../../src/render/track';
import { buildRoute, parseRouteText } from '../../src/route';
import { buildTimeline } from '../../src/story';
import { mercX, mercY, TILE_SIZE } from '../../src/story/mercator';
import { MAP_VIEWPORT, type Enrichment, type Format, type Lang, type Place, type StyleId } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';
import sampleGpx from '../../public/samples/wahrier-reconstruction.gpx?raw';
import { settings as baseSettings } from '../story/fixtures';

class FakePath2D { moveTo(): void { /* заглушка */ } lineTo(): void { /* заглушка */ } quadraticCurveTo(): void { /* заглушка */ } }
beforeAll(() => { vi.stubGlobal('Path2D', FakePath2D); });
afterAll(() => { vi.unstubAllGlobals(); });

interface Drawn { text: string; x: number; font: number }

/** Холст-«магнитофон»: пишет тексты с левым краем и кеглем; ширина текста — 0,62 кегля на знак (как у Manrope 600). */
function recorder() {
  const texts: Drawn[] = [];
  const state: Record<string, unknown> = { font: '10px sans-serif' };
  const size = () => Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? '10');
  const ctx = new Proxy({}, {
    get(_t, prop: string) {
      if (prop in state) return state[prop];
      switch (prop) {
        case 'measureText': return (s: string) => ({ width: s.length * size() * 0.62 });
        case 'getTransform': return () => ({ a: 2 });
        case 'createRadialGradient': case 'createLinearGradient': return () => ({ addColorStop: () => undefined });
        case 'fillText': return (s: string, x: number) => { texts.push({ text: s, x, font: size() }); };
        default: return () => undefined;
      }
    },
    set(_t, prop: string, value) { state[prop] = value; return true; },
    has: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}

const geo = createGeoIndex(JSON.parse(countriesRaw) as CountriesJson, JSON.parse(placesRaw) as PlacesJson);
const parsed = parseRouteText('wahrier-reconstruction.gpx', sampleGpx);
if (!parsed.ok) throw new Error(parsed.error);
const built = buildRoute(parsed.tracks);
if ('error' in built) throw new Error(built.error);
const route = built;
const sampleEnrichment: Enrichment = enrichRoute(route, geo);

const longPlace = (nameRu: string, nameEn: string): Place => ({ nameRu, nameEn, lat: 0, lon: 0, pop: 1 });
/** Те же биты, но у старта и финиша — самые широкие названия, какие бывают. */
const wideEnrichment: Enrichment = {
  ...sampleEnrichment,
  beats: sampleEnrichment.beats.map((b) => (b.kind === 'start'
    ? { ...b, place: longPlace('Санкт-Петербург-на-Неве', 'Saint Petersburg on the Neva') }
    : b.kind === 'finish' ? { ...b, place: longPlace('Петропавловск-Камчатский', 'Petropavlovsk-Kamchatsky') } : b)),
};

/** Рамки подписей старта и финиша на кадре t, дизайн-пиксели (CSS × 2): { left, right, top, bottom }. */
function labelBoxes(format: Format, styleId: StyleId, lang: Lang, enrichment: Enrichment, t: number) {
  const s = baseSettings({ format, styleId, lang, durationSec: 30 });
  const tl = buildTimeline(route, enrichment, s, timelineOptionsFor(format, styleId));
  const frame = tl.frameAt(t);
  const view = MAP_VIEWPORT[format];
  const world = TILE_SIZE * 2 ** frame.camera.zoom;
  const project = (lon: number, lat: number) => ({
    x: (mercX(lon) - mercX(frame.camera.center[0])) * world + view.width / 2,
    y: (mercY(lat) - mercY(frame.camera.center[1])) * world + view.height / 2,
  });
  const rec = recorder();
  drawTrackLayer({ ctx: rec.ctx, model: prepareTrack(route), route, enrichment, lang, frame, project, style: STYLES[styleId], view, endpointLabels: false });
  const style = STYLES[styleId];
  const fontPx = style.type.label.size / 2;
  const padX = fontPx * 0.6;
  const labels = enrichment.beats.filter((b) => b.kind === 'start' || b.kind === 'finish').map((b) =>
    ({ kind: b.kind, text: b.kind === 'finish' && frame.shot ? (lang === 'ru' ? 'Конец записи' : 'End of recording') : beatTitle(lang, b) }));
  return labels.flatMap(({ kind, text }) => {
    const hit = rec.texts.find((d) => d.text === text);
    if (!hit) return [];
    const w = text.length * hit.font * 0.62 + 2 * padX;
    const left = (hit.x - padX) * 2;
    return [{ kind, left, right: left + w * 2 }];
  });
}

const CASES: [Format, StyleId, Lang][] = [
  ['9:16', 'epic', 'ru'], ['9:16', 'epic', 'en'], ['9:16', 'atlas', 'ru'], ['9:16', 'atlas', 'en'], ['9:16', 'neon', 'en'],
  ['16:9', 'epic', 'ru'], ['16:9', 'epic', 'en'], ['16:9', 'atlas', 'ru'], ['16:9', 'atlas', 'en'], ['16:9', 'neon', 'ru'],
];

describe('подписи старта и финиша целиком в рабочей зоне на общем плане', () => {
  it.each(CASES)('%s %s %s: финальный кадр — обе подписи в WORK_AREA; 16:9 — и левее итогов', (format, styleId, lang) => {
    const work = WORK_AREA[format];
    const l = layoutFor(format, styleId);
    const limit = format === '16:9' ? Math.min(work.x + work.w, l.summary.x) : work.x + work.w;
    for (const enrichment of [sampleEnrichment, wideEnrichment]) {
      const boxes = labelBoxes(format, styleId, lang, enrichment, 30);
      expect(boxes.map((b) => b.kind).sort(), 'на финальном кадре видны обе подписи').toEqual(['finish', 'start']);
      for (const b of boxes) {
        expect(b.left, `${b.kind} слева`).toBeGreaterThanOrEqual(work.x - 1);
        expect(b.right, `${b.kind} справа`).toBeLessThanOrEqual(limit + 1);
      }
    }
  });

  it.each(CASES)('%s %s %s: интро — подпись старта тоже внутри', (format, styleId, lang) => {
    const work = WORK_AREA[format];
    const boxes = labelBoxes(format, styleId, lang, wideEnrichment, 1.5);
    expect(boxes.map((b) => b.kind)).toEqual(['start']);
    expect(boxes[0].left).toBeGreaterThanOrEqual(work.x - 1);
    expect(boxes[0].right).toBeLessThanOrEqual(work.x + work.w + 1);
  });
});

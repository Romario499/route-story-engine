import { expect, it } from 'vitest';
import { exportVideo, type ExportDeps } from '../../src/export';
import { createGeoIndex, enrichRoute } from '../../src/geo';
import { buildWaypointRoute } from '../../src/route';
import { buildTimeline } from '../../src/story';
import { timelineOptionsFor } from '../../src/render/layout';
import { drawOverlay } from '../../src/render/overlay';
import { STYLES } from '../../src/render/styles';
import { recorder } from './overlay-recorder';
import { jw, D0, DAY } from '../story/waypoint-fixtures';
import { settings } from '../story/fixtures';
import type { Enrichment, Route, StorySettings } from '../../src/types';
import countriesRaw from '../../public/data/countries.json?raw';
import placesRaw from '../../public/data/places.json?raw';

it('шов экспорта: выбранные данные, предзагрузка до кадра и те же подписи на 2/10/20/28 с', async () => {
  const points = [jw(48.8566, 2.3522, 'overnight', 0), jw(48.2082, 16.3738, 'overnight', 1),
    jw(48.8576, 2.3532, 'overnight', 2), jw(48.2092, 16.3748, 'overnight', 3), jw(52.52, 13.405, 'overnight', 365)];
  const route = buildWaypointRoute([{ sourceFile: 'synthetic.kml', segments: [], waypoints: [],
    kmlImport: { points, organic: true, content: true, index: false, lines: 0, collections: ['synthetic'] } }], { from: D0, to: D0 + 4 * DAY });
  if ('error' in route) throw new Error(route.error);
  const geo = createGeoIndex(JSON.parse(countriesRaw), JSON.parse(placesRaw));
  const enrichment = enrichRoute(route, geo);
  expect(enrichment.countries.map(c => c.iso2)).toEqual(['FR', 'AT']);
  expect(route.importReport).toMatchObject({ unique: 5, included: 4 });
  for (const format of ['9:16', '16:9'] as const) for (const styleId of ['epic', 'atlas', 'neon'] as const) {
    const s = settings({ format, styleId }), options = timelineOptionsFor(format, styleId);
    const preview = buildTimeline(route, enrichment, s, options);
    const expected: Record<number, string[]> = {};
    for (const t of [2, 10, 20, 28]) {
      const rec = recorder();
      drawOverlay(rec.ctx, preview.frameAt(t), { route, enrichment, settings: s, style: STYLES[styleId], reconstruction: false });
      expected[t] = rec.texts;
    }
    let data: { route: Route; enrichment: Enrichment; settings: StorySettings };
    let assetsReady = false, lastTime = -1, encoded = 0;
    const seen: Record<number, string[]> = {};
    const deps: ExportDeps = {
      createHost: () => ({ host: {} as HTMLElement, dispose() {} }), ensureFonts: async () => {},
      createScene: async (_host, opts) => {
        expect(opts).toEqual({ format, styleId, pixelRatio: 2 });
        return { canvas: {} as HTMLCanvasElement, setStyle: async () => {}, destroy() {},
          setData(r, e, st) { data = { route: r, enrichment: e, settings: st }; },
          async render(frame) {
            expect(assetsReady).toBe(true); expect(frame.t).toBeGreaterThan(lastTime); lastTime = frame.t;
            if ([2, 10, 20, 28].includes(frame.t)) {
              const rec = recorder();
              drawOverlay(rec.ctx, frame, { ...data!, style: STYLES[styleId], reconstruction: false });
              seen[frame.t] = rec.texts;
            }
            return { tilesComplete: true };
          },
        };
      },
      watchWebglLoss: () => () => {}, preloadAssets: async e => { expect(e).toBe(enrichment); assetsReady = true; },
      detect: async () => ({ supported: true, container: 'mp4', codec: 'avc1.640028' }),
      createEncoder: () => ({ encodeQueueSize: 0, state: 'configured', configure() {}, encode() { encoded++; },
        flush: async () => {}, close() {}, addEventListener() {}, removeEventListener() {} }),
      createVideoFrame: () => ({ close() {} } as VideoFrame),
      createMuxer: () => ({ addChunk() {}, finish: () => new Blob() }),
    };
    const result = await exportVideo({ route, enrichment, settings: s, timelineOptions: options,
      signal: new AbortController().signal, onProgress() {}, reconstruction: false }, deps);
    expect(result.frames).toBe(900); expect(encoded).toBe(900); expect(seen).toEqual(expected);
    expect(Object.values(seen).flat().join(' ')).not.toMatch(/Берлин|Berlin|Германия|Germany/);
  }
});

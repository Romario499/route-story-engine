import { describe, expect, it } from 'vitest';
import { parseRouteFiles, ROUTE_ERRORS } from '../../src/route';

import trackGpx from '../fixtures/track.gpx?raw';
import commaCsv from '../fixtures/track-comma.csv?raw';
import brokenGeojson from '../fixtures/broken.geojson?raw';

describe('parseRouteFiles', () => {
  it('читает несколько файлов и возвращает по треку на файл в порядке выбора', async () => {
    const r = await parseRouteFiles([new File([trackGpx], 'day1.gpx'), new File([commaCsv], 'day2.csv')]);
    if (!r.ok) throw new Error(r.error);
    expect(r.tracks.map((t) => t.sourceFile)).toEqual(['day1.gpx', 'day2.csv']);
    expect(r.tracks[1].segments[0]).toHaveLength(4);
  });

  it('один битый файл из нескольких — ошибка с именем файла', async () => {
    const r = await parseRouteFiles([new File([trackGpx], 'day1.gpx'), new File([brokenGeojson], 'day2.geojson')]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^day2\.geojson: Не удалось прочитать файл:/);
  });

  it('один файл — ошибка без префикса; пустой список — «нет точек»', async () => {
    expect(await parseRouteFiles([new File([''], 'empty.gpx')])).toEqual({ ok: false, error: ROUTE_ERRORS.empty });
    expect(await parseRouteFiles([])).toEqual({ ok: false, error: ROUTE_ERRORS.empty });
  });

  it('CSV из русского Excel в windows-1251 читается', async () => {
    // «широта;долгота» в cp1251
    const header = [0xf8, 0xe8, 0xf0, 0xee, 0xf2, 0xe0, 0x3b, 0xe4, 0xee, 0xeb, 0xe3, 0xee, 0xf2, 0xe0];
    const body = Array.from(new TextEncoder().encode('\n41,5;69,25\n41,6;69,35\n'));
    const r = await parseRouteFiles([new File([new Uint8Array([...header, ...body])], 'excel.csv')]);
    if (!r.ok) throw new Error(r.error);
    expect(r.tracks[0].segments[0]).toEqual([{ lat: 41.5, lon: 69.25 }, { lat: 41.6, lon: 69.35 }]);
  });
});

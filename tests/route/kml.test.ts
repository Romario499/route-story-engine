import { expect, it } from 'vitest';
import { buildRoute, parseRouteFiles, parseRouteText } from '../../src/route';
import waypoints from '../fixtures/synthetic/waypoints.kml?raw';
import { inflateRawSync } from 'node:zlib';
import { syntheticZip } from './zip-fixture';

it('цветной Google Earth KML сохраняет unknown/unknown без семантики Organic Maps и hex-догадок', () => {
  const xml = `<kml><Document><Style id="green"><IconStyle><color>ff00ff00</color></IconStyle></Style>
    <Style id="lime"><IconStyle><color>ff00ff80</color></IconStyle></Style>
    <Style id="named"><IconStyle><Icon><href>placemark-green.png</href></Icon></IconStyle></Style>
    <Placemark><name>A</name><styleUrl>#green</styleUrl><Point><coordinates>10,50</coordinates></Point></Placemark>
    <Placemark><name>B</name><styleUrl>#lime</styleUrl><Point><coordinates>11,51</coordinates></Point></Placemark>
    <Placemark><name>C</name><styleUrl>#named</styleUrl><Point><coordinates>12,52</coordinates></Point></Placemark></Document></kml>`;
  const parsed = parseRouteText('earth.kml', xml);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.tracks[0].kmlImport?.organic).toBe(false);
  const route = buildRoute(parsed.tracks);
  if ('error' in route) throw new Error(route.error);
  expect(route.journeyWaypoints?.map((p) => [p.kind, p.confidence])).toEqual([
    ['unknown', 'unknown'], ['unknown', 'unknown'], ['unknown', 'unknown'],
  ]);
  expect(route.journeyWaypoints?.map((p) => p.color)).toEqual(['ff00ff00', 'ff00ff80', 'green']);
});

it.each(['LineString', 'gx:Track'])('KML: %s из 50 точек имеет приоритет над метками старта и финиша', (geometry) => {
  const coordinates = Array.from({ length: 50 }, (_, i) => [10 + i * 0.001, 50, 100 + i]);
  const line = geometry === 'LineString'
    ? `<LineString><coordinates>${coordinates.map((p) => p.join(',')).join(' ')}</coordinates></LineString>`
    : `<gx:Track>${coordinates.map((p, i) => `<when>2025-01-01T00:${String(i).padStart(2, '0')}:00Z</when><gx:coord>${p.join(' ')}</gx:coord>`).join('')}</gx:Track>`;
  const xml = `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark>${line}</Placemark>
    <Placemark><name>Start</name><Point><coordinates>10,50</coordinates></Point></Placemark>
    <Placemark><name>Finish</name><Point><coordinates>10.049,50</coordinates></Point></Placemark></Document></kml>`;
  const parsed = parseRouteText('earth.kml', xml);
  if (!parsed.ok) throw new Error(parsed.error);
  const route = buildRoute(parsed.tracks);
  if ('error' in route) throw new Error(route.error);
  expect(route.source?.kind).not.toBe('waypoints');
  expect(route.points.map((p) => [p.lon, p.lat, p.ele])).toEqual(coordinates);
  expect(route.totalM).toBeGreaterThan(3000);
  expect(route.hasEle).toBe(true);
  expect(route.hasTime).toBe(geometry === 'gx:Track');
  expect(route.waypoints.map((p) => [p.name, p.idx])).toEqual([['Start', 0], ['Finish', 49]]);
});

it('KML: LineString и gx:Track читаются без DOM; опасный и повреждённый XML отклоняется', () => {
  const xml = `<k:kml xmlns:k="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><k:Document>
    <k:name>Test &amp; route</k:name><k:Placemark><k:LineString><k:coordinates>10,50,100 11,51,120</k:coordinates></k:LineString></k:Placemark>
    <k:Placemark><gx:Track><k:when>2025-01-01T00:00:00Z</k:when><k:when>2025-01-01T01:00:00Z</k:when><gx:coord>12 52 130</gx:coord><gx:coord>13 53 140</gx:coord></gx:Track></k:Placemark>
  </k:Document></k:kml>`;
  const result = parseRouteText('earth.kml', xml);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.tracks[0].name).toBe('Test & route');
  expect(result.tracks[0].segments).toEqual([
    [{ lon: 10, lat: 50, ele: 100 }, { lon: 11, lat: 51, ele: 120 }],
    [{ lon: 12, lat: 52, ele: 130, time: Date.UTC(2025, 0, 1) }, { lon: 13, lat: 53, ele: 140, time: Date.UTC(2025, 0, 1, 1) }],
  ]);
  const route = buildRoute(result.tracks);
  if ('error' in route) throw new Error(route.error);
  expect(route.source?.kind).not.toBe('waypoints');
  expect(route.points.map((p) => [p.lon, p.lat])).toEqual([[10, 50], [11, 51], [12, 52], [13, 53]]);
  expect(route.totalM).toBeGreaterThan(100000);
  expect(parseRouteText('earth.xml', xml).ok).toBe(true);
  for (const unsafe of ['<!DOCTYPE kml [<!ENTITY e SYSTEM "file:///secret">]>' + xml, xml.slice(0, -8), '<kml><Document></kml>']) {
    const r = parseRouteText('bad.kml', unsafe);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Не удалось прочитать файл:/);
  }
  expect(parseRouteText('empty.kml', '<kml/>')).toEqual({ ok: false, error: 'В файле нет точек маршрута' });
});

it('отчёт учитывает пустую коллекцию; XML с неверными сущностями и внешние KML-ссылки не принимаются', async () => {
  const generic = '<kml><Document><name>Generic</name><Placemark><name>A</name><Point><coordinates>10,50</coordinates></Point></Placemark><Placemark><name>B</name><Point><coordinates>11,51</coordinates></Point></Placemark></Document></kml>';
  const zip = syntheticZip([{ name: 'empty.kml', text: '<kml><Document><name>Empty</name></Document></kml>' }, { name: 'points.kml', text: generic }]);
  const result = await parseRouteFiles([new File([new Uint8Array(zip)], 'generic.kmz')]);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.report?.kmlFiles).toBe(2);
  expect(result.report?.collections).toHaveLength(2);
  const route = buildRoute(result.tracks);
  if ('error' in route) throw new Error(route.error);
  expect(route.journeyWaypoints?.map((p) => [p.kind, p.confidence, p.markedAt])).toEqual([['unknown', 'unknown', undefined], ['unknown', 'unknown', undefined]]);
  for (const text of [generic.replace('>A<', '>A &broken<'), generic.replace('>A<', '>A &secret;<'), generic.replace('</Document>', '<NetworkLink><Link><href>https://example.invalid/external.kml</href></Link></NetworkLink></Document>')]) {
    expect(parseRouteText('bad.kml', text).ok).toBe(false);
  }
});

it('KMZ: stored/deflate, внутренние NetworkLink и дубли между KML; небезопасный ZIP отклоняется', async () => {
  const index = '<kml><Document><NetworkLink><Link><href>collections/a.kml</href></Link></NetworkLink><NetworkLink><Link><href>collections/b.kml</href></Link></NetworkLink></Document></kml>';
  const bytes = syntheticZip([{ name: 'doc.kml', text: index }, { name: 'collections/a.kml', text: waypoints, deflate: true }, { name: 'collections/b.kml', text: waypoints }]);
  const options = { inflateRaw: async (b: Uint8Array) => new Uint8Array(inflateRawSync(b, { maxOutputLength: 32 * 1024 * 1024 })) };
  const result = await parseRouteFiles([new File([new Uint8Array(bytes)], 'backup.kmz')], options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  expect(result.report).toMatchObject({ total: 16, unique: 7, duplicates: 9, excludedPersonal: 1, excludedOtherColors: 1, included: 6, kmlFiles: 2, lines: 2 });
  expect(result.report?.collections).toHaveLength(2);
  const route = buildRoute(result.tracks);
  if ('error' in route) throw new Error(route.error);
  expect(route.source?.kind).not.toBe('waypoints');
  expect(route.points.map((p) => [p.lon, p.lat])).toEqual([[20, 50], [21, 51], [20, 50], [21, 51]]);
  expect(route.totalM).toBeGreaterThan(100000);
  // Реальная браузерная ветка Web API также доступна в Node 24.
  expect((await parseRouteFiles([new File([new Uint8Array(bytes)], 'backup.kmz')])).ok).toBe(true);
  const crcBroken = syntheticZip([{ name: 'a.kml', text: waypoints }]); crcBroken[40] ^= 1;
  for (const bad of [bytes.slice(0, -8), crcBroken,
    syntheticZip([{ name: '../escape.kml', text: waypoints }]),
    syntheticZip([{ name: 'a.kml', text: waypoints }, { name: 'a.kml', text: waypoints }]),
    syntheticZip([{ name: 'doc.kml', text: index }]),
    syntheticZip([{ name: 'doc.kml', text: '<kml><NetworkLink><Link><href>https://example.invalid/private.kml</href></Link></NetworkLink></kml>' }]),
  ]) {
    const r = await parseRouteFiles([new File([new Uint8Array(bad)], 'bad.kmz')], options);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^Не удалось прочитать файл:/);
  }
});

it.each(['LF', 'CRLF'])('метки (%s): цвета, markedAt, дедупликация и личные закладки; build не выдумывает GPS-статистику', (ending) => {
  // Проверяем режим меток на файле без трека; смешанный файл отдельно проверен выше.
  const input = waypoints.replace(/\r?\n/g, ending === 'CRLF' ? '\r\n' : '\n');
  const pointsOnly = input.replace(/<Placemark><name>Old walk<\/name><LineString>.*?<\/LineString><\/Placemark>\r?\n/, '');
  const result = parseRouteText('organic.kml', pointsOnly);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  const route = buildRoute(result.tracks);
  expect('error' in route).toBe(false);
  if ('error' in route) throw new Error(route.error);
  expect(route.source).toEqual({ kind: 'waypoints' });
  expect(route.journeyWaypoints?.map((p) => [p.name, p.kind, p.confidence, p.duplicates])).toEqual([
    ['Older private', 'stop', 'unknown', 0],
    ['Start & camp', 'overnight', 'stated', 0], ['Camp two', 'overnight', 'stated', 1],
    ['Train <stop>', 'train', 'stated', 0], ['Unconfirmed stop', 'stop', 'unknown', 0], ['Undated private', 'overnight', 'stated', 0],
  ]);
  expect(route.journeyWaypoints?.find(p => p.name === 'Start & camp')?.markedAt).toBe(Date.UTC(2024, 10, 10));
  expect(route.journeyWaypoints?.[0].source).toEqual({ file: 'organic.kml', collection: 'Synthetic collection / Synthetic journey' });
  expect(result.tracks[0].segments).toEqual([]);
  expect(result.report).toMatchObject({ total: 8, unique: 7, duplicates: 1, excludedPersonal: 1, excludedOtherColors: 1, included: 6, lines: 0, kmlFiles: 1 });
  expect(result.tracks[0].kmlImport?.points.some(p => p.color === 'blue')).toBe(true);
  expect(result.report?.collections).toEqual([{ file: 'organic.kml', collection: 'Synthetic collection / Synthetic journey', total: 8, unique: 7 }]);
  expect(route.totalM).toBe(0); expect(route.ownM).toBe(0);
  expect(route.points).toHaveLength(6);
  expect(route.points.every((p) => p.time === undefined && p.ele === undefined && p.d === 0)).toBe(true);
  expect(route.hasTime).toBe(false); expect(route.hasEle).toBe(false);
  expect(route.speedKmh).toBeUndefined(); expect(route.startTime).toBeUndefined(); expect(route.gainM).toBeUndefined();
});

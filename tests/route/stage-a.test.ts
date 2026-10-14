import { expect, it } from 'vitest';
import { buildRoute, buildWaypointRoute, parseRouteText, summarizeKmlImport } from '../../src/route';

it('подтверждённая последовательность следует времени создания, равные даты стабильны, недатированные в конце', () => {
  const marks = [
    ['undated-first', '', 30], ['late', '2025-03-03', 31], ['tie-first', '2025-02-02', 32],
    ['early', '2025-01-01', 33], ['tie-second', '2025-02-02', 34], ['undated-last', '', 35],
  ] as const;
  const placemarks = marks.map(([name, date, lon]) => `<Placemark><name>${name}</name><styleUrl>#placemark-green</styleUrl>${date ? `<TimeStamp><when>${date}T00:00:00Z</when></TimeStamp>` : ''}<Point><coordinates>${lon},40</coordinates></Point></Placemark>`);
  const parsed = parseRouteText('synthetic.kml', `<kml><Document><Folder><name>First</name>${placemarks.join('')}</Folder><Folder><name>Duplicate collection</name>${[...placemarks].reverse().join('')}</Folder></Document></kml>`);
  if (!parsed.ok) throw new Error(parsed.error);
  const route = buildWaypointRoute(parsed.tracks, { waypointOrderConfirmed: true });
  if ('error' in route) throw new Error(route.error);
  expect(route.waypointOrderConfirmed).toBe(true);
  expect(route.journeyWaypoints!.map(p => p.name)).toEqual(['early', 'tie-first', 'tie-second', 'late', 'undated-first', 'undated-last']);
  expect(route.points.map(p => p.lon)).toEqual([33, 32, 34, 31, 30, 35]);
  expect(route.importReport).toMatchObject({ unique: 6, duplicates: 6, included: 6 });
  const overview = buildWaypointRoute(parsed.tracks);
  if ('error' in overview) throw new Error(overview.error);
  expect(overview.waypointOrderConfirmed).toBe(false);
  expect(new Set(overview.journeyWaypoints!.map(p => p.name))).toEqual(new Set(marks.map(p => p[0])));
});

it('полный Organic Maps сохраняет вчерашнюю, старую, недатированную и соседнюю метки точно', () => {
  const points = [
    ['old', '2010-01-01', 'blue', 30.12345678],
    ['recent', '2026-10-12', 'green', 30.12345678],
    ['near', '2026-10-12', 'green', 30.12405678],
    ['untimed', '', 'red', 30.12505678],
  ] as const;
  const xml = `<kml><Document>${points.map(([name, date, color, lon]) => `<Placemark><name>${name}</name><styleUrl>#placemark-${color}</styleUrl>${date ? `<TimeStamp><when>${date}T00:00:00Z</when></TimeStamp>` : ''}<Point><coordinates>${lon},40.98765432</coordinates></Point></Placemark>`).join('')}</Document></kml>`;
  const parsed = parseRouteText('synthetic.kml', xml);
  if (!parsed.ok) throw new Error(parsed.error);
  const before = JSON.stringify(parsed.tracks);
  const summary = summarizeKmlImport(parsed.tracks);
  expect(summary.all.map(p => p.lon)).toEqual(points.map(p => p[3]));
  expect(summary.all.every(p => p.lat === 40.98765432)).toBe(true);
  expect(summary.selected).toHaveLength(3);
  expect(summary.report.excludedOtherColors).toBe(1);
  const route = buildRoute(parsed.tracks);
  if ('error' in route) throw new Error(route.error);
  expect(route.points).toHaveLength(3);
  const withOtherColors = buildWaypointRoute(parsed.tracks, { includeOtherColors: true });
  if ('error' in withOtherColors) throw new Error(withOtherColors.error);
  expect(withOtherColors.points.map(p => p.lon)).toEqual(points.map(p => p[3]));
  expect(JSON.stringify(parsed.tracks)).toBe(before);
});

it('прочие цвета и конфликт дублей сохраняются в импорте, но требуют явного включения в ролик', () => {
  const colors = ['green', 'red', 'brown', 'pink', 'green', 'yellow'];
  const xml = `<kml><Document>${colors.map((color, i) => `<Placemark><name>mark-${i === 5 ? 4 : i}</name><styleUrl>#placemark-${color}</styleUrl><TimeStamp><when>2025-01-01T12:00:00Z</when></TimeStamp><Point><coordinates>${30 + (i === 5 ? 4 : i)},40</coordinates></Point></Placemark>`).join('')}</Document></kml>`;
  const parsed = parseRouteText('synthetic.kml', xml);
  if (!parsed.ok) throw new Error(parsed.error);
  const summary = summarizeKmlImport(parsed.tracks);
  expect(summary.all).toHaveLength(5);
  expect(summary.selected.map(p => p.color)).toEqual(['green', 'red']);
  expect(summary.report).toMatchObject({ unique: 5, included: 2, excludedOtherColors: 3, duplicates: 1 });
  const before = JSON.stringify(parsed.tracks);
  const route = buildWaypointRoute(parsed.tracks);
  if ('error' in route) throw new Error(route.error);
  expect(route.points.map(p => p.lon)).toEqual([30, 31]);
  expect(summarizeKmlImport(parsed.tracks, { includeOtherColors: true }).selected).toHaveLength(5);
  expect(JSON.stringify(parsed.tracks)).toBe(before);
});

import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { syntheticZip } from './zip-fixture';

it('огрублённая выборка убирает точные названия меток и пути исходника/вложенного KML', () => {
  const directory = mkdtempSync(join(tmpdir(), 'route-story-privacy-'));
  const input = join(directory, 'SyntheticBackup_261011.kmz'), output = join(directory, 'coarse.json');
  const xml = `<kml><Document><name>Synthetic collection</name>
    <Placemark><name>Synthetic street 123, room 4</name><styleUrl>#placemark-green</styleUrl><TimeStamp><when>2025-01-01T00:00:00Z</when></TimeStamp><Point><coordinates>30.123456,40.654321</coordinates></Point></Placemark>
    <Placemark><name>Synthetic campsite precise address</name><styleUrl>#placemark-green</styleUrl><TimeStamp><when>2025-01-02T00:00:00Z</when></TimeStamp><Point><coordinates>31.123456,40.654321</coordinates></Point></Placemark>
    </Document></kml>`;
  const bytes = syntheticZip([{ name: 'nested/private-points.kml', text: xml }]);
  writeFileSync(input, bytes);
  const sample = spawnSync('node', ['scripts/waypoints-sample.mjs', input, '--segment', '2025-01-01', '2025-01-02', '--out', output], { encoding: 'utf8' });
  expect(sample.status, sample.stderr).toBe(0);
  const text = new TextDecoder().decode(readFileSync(output)), result = JSON.parse(text);
  expect(result.waypoints).toHaveLength(2);
  expect(result.waypoints.map((p: { name?: string }) => p.name)).toEqual([undefined, undefined]);
  expect(result.waypoints.map((p: { source: { file: string; collection: string } }) => p.source)).toEqual([
    { file: 'Synthetic collection', collection: 'Synthetic collection' },
    { file: 'Synthetic collection', collection: 'Synthetic collection' },
  ]);
  for (const privateText of ['Synthetic street', 'Synthetic campsite', directory, 'private-points.kml', 'nested/', '30.123456']) {
    expect(text).not.toContain(privateText);
  }
  expect(createHash('sha256').update(readFileSync(input)).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
});

it('офлайн-скрипт: сводка/sha256, только выбранный участок, сетка 0.1°, последние 90 дней скрыты', () => {
  const directory = mkdtempSync(join(tmpdir(), 'route-story-synthetic-'));
  const input = join(directory, 'SyntheticBackup_261011.kmz'), output = join(directory, 'coarse.json');
  const point = (name: string, date: string, color = 'green') => `<Placemark><name>${name}</name><TimeStamp><when>${date}T12:00:00Z</when></TimeStamp><styleUrl>#placemark-${color}</styleUrl><Point><coordinates>30.123456,40.654321</coordinates></Point></Placemark>`;
  const xml = '<kml><Document>' + point('outside', '2024-11-01') + point('chosen', '2025-01-01') + point('cutoff', '2026-07-13') + point('recent', '2026-07-14') + point('latest', '2026-10-11') + point('private', '2025-01-02', 'blue') + '</Document></kml>';
  const bytes = syntheticZip([{ name: 'a.kml', text: xml, deflate: true }]); writeFileSync(input, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const run = (...args: string[]) => spawnSync('node', ['scripts/waypoints-sample.mjs', input, ...args], { encoding: 'utf8' });
  const report = run('--report');
  expect(report.status, report.stderr).toBe(0);
  const parsed = JSON.parse(report.stdout);
  expect(parsed).toMatchObject({ sha256: digest, total: 6, unique: 6, kmlFiles: 1, lines: 0, included: 5, excludedPersonal: 1, excludedOtherColors: 1 });
  const sample = run('--segment', '2025-01-01', '2026-10-11', '--out', output);
  expect(sample.status, sample.stderr).toBe(0);
  const result = JSON.parse(new TextDecoder().decode(readFileSync(output)));
  expect(result.source).toEqual({ kind: 'waypoints' });
  expect(result.waypoints.map((p: { markedAt: number }) => p.markedAt)).toEqual([Date.UTC(2025, 0, 1, 12), Date.UTC(2026, 6, 13, 12)]);
  expect(result.waypoints.map((p: { name?: string }) => p.name)).toEqual([undefined, undefined]);
  expect(result.waypoints.every((p: { lon: number; lat: number }) => p.lon === 30.1 && p.lat === 40.7)).toBe(true);
  expect(result.privacy).toMatchObject({ gridDegrees: 0.1, excludedRecent: 2, fileDate: '2026-10-11' });
  expect(new TextDecoder().decode(readFileSync(output))).not.toContain('30.123456');
  expect(createHash('sha256').update(readFileSync(input)).digest('hex')).toBe(digest);
  expect(run('--segment', '2025-01-01', '2026-10-11', '--out', input).status).not.toBe(0);
  expect(run('--out', output).status).not.toBe(0);
});

// Закладки ставят в любой точке мира, а время — момент создания: выборка «участка» по датам ловит чужие места (проба Узбекистана).
function syntheticOutlierBackup() {
  const directory = mkdtempSync(join(tmpdir(), 'route-story-geo-'));
  const input = join(directory, 'SyntheticBackup_261011.kmz');
  const point = (name: string, date: string, lon: number, lat: number, color = 'green') =>
    `<Placemark><name>${name}</name><TimeStamp><when>${date}T12:00:00Z</when></TimeStamp><styleUrl>#placemark-${color}</styleUrl><Point><coordinates>${lon},${lat}</coordinates></Point></Placemark>`;
  const xml = '<kml><Document><name>Synthetic collection</name>'
    + point('a', '2025-03-01', 30.12, 40.65, 'lime')
    + point('far-east', '2025-03-02', 114.21, 22.31)            // выброс: закладка из другого города в те же сутки
    + point('b', '2025-03-03', 31.12, 40.65)
    + point('b-again', '2025-03-03', 31.14, 40.66)               // после огрубления до 0,1° — тот же пункт, те же сутки
    + point('far-west', '2025-03-04', 44.51, 40.21)              // выброс: другая страна
    + point('c', '2025-03-05', 32.12, 40.15)
    + '</Document></kml>';
  writeFileSync(input, syntheticZip([{ name: 'a.kml', text: xml, deflate: true }]));
  const run = (...args: string[]) => {
    const output = join(directory, `out-${args.join('_').replace(/[^\w.-]/g, '')}.json`);
    const result = spawnSync('node', ['scripts/waypoints-sample.mjs', input, '--segment', '2025-03-01', '2025-03-05', '--out', output, ...args], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    return { summary: JSON.parse(result.stdout), sample: JSON.parse(new TextDecoder().decode(readFileSync(output))) };
  };
  return { run };
}

it('участок ограничен страной: метки вне исключены и посчитаны, точные дубли после огрубления схлопнуты', () => {
  const { summary, sample } = syntheticOutlierBackup().run();
  expect(summary).toMatchObject({ selected: 3, excludedOutside: 2, collapsedDuplicates: 1, country: 'TR' });
  expect(sample.waypoints.map((p: { lon: number; lat: number }) => [p.lon, p.lat])).toEqual([[30.1, 40.7], [31.1, 40.7], [32.1, 40.2]]);
  expect(sample.waypoints.map((p: { duplicates: number }) => p.duplicates)).toEqual([0, 1, 0]);
  expect(sample.segment).toMatchObject({ from: '2025-03-01', to: '2025-03-05', country: 'TR', excludedOutside: 2 });
});

it('явная рамка --bbox и явная страна дают тот же отбор', () => {
  const { run } = syntheticOutlierBackup();
  expect(run('--bbox', '29', '39', '34', '42').summary).toMatchObject({ selected: 3, excludedOutside: 2 });
  expect(run('--country', 'TR').summary).toMatchObject({ selected: 3, excludedOutside: 2, country: 'TR' });
});

it('явный участок начинается с ранней метки вне Турции, даже если позже есть турецкое семя', () => {
  const directory = mkdtempSync(join(tmpdir(), 'route-story-period-'));
  const input = join(directory, 'SyntheticBackup_261011.kmz'), output = join(directory, 'coarse.json');
  const point = (lon: number, lat: number, day: string) => `<Placemark><styleUrl>#placemark-green</styleUrl><TimeStamp><when>${day}T12:00:00Z</when></TimeStamp><Point><coordinates>${lon},${lat}</coordinates></Point></Placemark>`;
  writeFileSync(input, syntheticZip([{ name: 'a.kml', text: '<kml><Document>'
    + point(-20.3, 10.1, '2025-03-01') + point(30.5, 40.2, '2025-03-02') + '</Document></kml>' }]));
  const result = spawnSync('node', ['scripts/waypoints-sample.mjs', input, '--segment', '2025-03-01', '2025-03-02',
    '--bbox', '-21', '9', '-20', '11', '--out', output], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  const sample = JSON.parse(new TextDecoder().decode(readFileSync(output)));
  expect(sample.waypoints.map((p: { markedAt: number }) => p.markedAt)).toEqual([Date.UTC(2025, 2, 1, 12)]);
  expect(JSON.parse(result.stdout)).toMatchObject({ selected: 1, excludedOutside: 1 });
});

it('нельзя отключить географическую границу участка через --country any', () => {
  const output = join(mkdtempSync(join(tmpdir(), 'route-story-boundary-')), 'coarse.json');
  const result = spawnSync('node', ['scripts/waypoints-sample.mjs', 'tests/fixtures/synthetic/waypoints.kml',
    '--segment', '2025-01-01', '2025-01-05', '--file-date', '2026-10-11', '--country', 'any', '--out', output], { encoding: 'utf8' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('--country');
});

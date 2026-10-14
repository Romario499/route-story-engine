// CSV: заголовок с колонками широты/долготы (+ высота, время), разделитель «,», «;» или табуляция.
// При «;» и табуляции допускается десятичная запятая (так сохраняет русский Excel).
import type { RawTrack, TrackPoint } from '../types';
import { ROUTE_ERRORS, RouteParseError } from './errors';
import { parseTime } from './time';

const LAT = ['lat', 'latitude', 'широта'];
const LON = ['lon', 'lng', 'long', 'longitude', 'долгота'];
const ELE = ['ele', 'elevation', 'alt', 'altitude', 'высота'];
const TIME = ['timestamp', 'datetime', 'date_time', 'time', 'время'];
const DATE = ['date', 'дата'];

function normalizeHeader(h: string): string {
  return h.replace(/^﻿/, '').trim().replace(/^["']|["']$/g, '').split(/[([]/)[0].trim().toLowerCase();
}

function splitLine(line: string, delim: string): string[] {
  if (!line.includes('"')) return line.split(delim);
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function looksLikeCsv(text: string): boolean {
  const first = text.replace(/^﻿/, '').split(/\r?\n|\r/, 1)[0] ?? '';
  const delim = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const headers = splitLine(first, delim).map(normalizeHeader);
  return headers.some((h) => LAT.includes(h)) && headers.some((h) => LON.includes(h));
}

export function parseCsv(fileName: string, input: string): { track: RawTrack; warnings: string[] } {
  const lines = input.replace(/^﻿/, '').split(/\r?\n|\r/);
  let h = 0;
  while (h < lines.length && !lines[h].trim()) h++;
  const header = lines[h] ?? '';
  const delim = header.includes(';') ? ';' : header.includes('\t') ? '\t' : ',';
  const decimalComma = delim !== ',';
  const cols = splitLine(header, delim).map(normalizeHeader);
  const find = (names: string[]) => {
    for (const n of names) {
      const i = cols.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const latI = find(LAT);
  const lonI = find(LON);
  if (latI < 0 || lonI < 0) {
    throw new RouteParseError(ROUTE_ERRORS.unreadable('в CSV нет колонок широты и долготы (lat/lon или широта/долгота)'));
  }
  const eleI = find(ELE);
  let timeI = find(TIME);
  const dateI = find(DATE);
  if (timeI < 0) timeI = dateI;
  const joinDate = dateI >= 0 && timeI !== dateI;

  const num = (s: string | undefined): number => {
    if (s === undefined) return NaN;
    let v = s.trim().replace(/^["']|["']$/g, '');
    if (!v) return NaN;
    if (decimalComma) v = v.replace(',', '.');
    return Number(v);
  };

  const seg: TrackPoint[] = [];
  let bad = 0;
  for (let i = h + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = splitLine(line, delim);
    const lat = num(f[latI]);
    const lon = num(f[lonI]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { bad++; continue; }
    const p: TrackPoint = { lat, lon };
    if (eleI >= 0) {
      const e = num(f[eleI]);
      if (Number.isFinite(e)) p.ele = e;
    }
    if (timeI >= 0) {
      let raw = (f[timeI] ?? '').trim();
      // отдельные колонки «дата» и «время»
      if (joinDate && /^\d{1,2}:\d{2}/.test(raw)) raw = `${(f[dateI] ?? '').trim()} ${raw}`;
      const t = parseTime(raw);
      if (t !== undefined) p.time = t;
    }
    seg.push(p);
  }

  const warnings: string[] = [];
  if (bad) warnings.push(`${fileName}: пропущено строк без координат — ${bad}`);
  return { track: { sourceFile: fileName, segments: seg.length ? [seg] : [], waypoints: [] }, warnings };
}

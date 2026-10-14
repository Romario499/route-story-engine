import type { RawTrack } from '../types';
import { ROUTE_ERRORS, RouteParseError } from './errors';
import { parseKml } from './kml';
import { descendants, parseXml } from './xml';

export interface KmzOptions { inflateRaw?: (data: Uint8Array) => Promise<Uint8Array> }
const MAX_FILE = 32 * 1024 * 1024, MAX_TOTAL = 64 * 1024 * 1024;
const fail = (): never => { throw new RouteParseError(ROUTE_ERRORS.unreadable('повреждённый или небезопасный архив KMZ')); };

function safePath(name: string): string {
  if (!name || /[\\\u0000-\u001f:?#]/.test(name) || name.startsWith('/')) return fail();
  const parts = name.split('/');
  if (parts.some((p) => p === '..')) return fail();
  return parts.filter((p) => p && p !== '.').join('/');
}

function linkPath(directory: string, href: string): string {
  const decoded = decodeURIComponent(href.split('#')[0]);
  if (!decoded || /[\\\u0000-\u001f:?#]/.test(decoded) || decoded.startsWith('/')) return fail();
  const parts = directory.split('/').filter(Boolean);
  for (const part of decoded.split('/')) {
    if (part === '..') { if (!parts.length) return fail(); parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return safePath(parts.join('/'));
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflateBrowser(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_FILE) { await reader.cancel(); fail(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

export async function parseKmz(fileName: string, bytes: Uint8Array, options: KmzOptions = {}): Promise<RawTrack[]> {
  if (bytes.length < 22 || bytes.length > MAX_TOTAL) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (p: number) => { if (p < 0 || p + 2 > bytes.length) return fail(); return view.getUint16(p, true); };
  const u32 = (p: number) => { if (p < 0 || p + 4 > bytes.length) return fail(); return view.getUint32(p, true); };
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && (u32(end) !== 0x06054b50 || end + 22 + u16(end + 20) !== bytes.length)) end--;
  if (end < Math.max(0, bytes.length - 65557)) fail();
  const count = u16(end + 10), directorySize = u32(end + 12), directoryStart = u32(end + 16);
  if (!count || count > 256 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || directoryStart + directorySize !== end) fail();
  let at = directoryStart, total = 0;
  const names = new Set<string>(), documents = new Map<string, string>();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail();
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), size = u32(at + 20), plainSize = u32(at + 24);
    const nameSize = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), local = u32(at + 42);
    if (at + 46 + nameSize + extra + comment > end || u16(at + 34) || (flags & 0x41) || (method !== 0 && method !== 8)) fail();
    const rawName = decoder.decode(bytes.subarray(at + 46, at + 46 + nameSize)), name = safePath(rawName);
    if (names.has(name)) fail(); names.add(name);
    total += plainSize;
    if (plainSize > MAX_FILE || total > MAX_TOTAL || local + 30 > directoryStart || u32(local) !== 0x04034b50) fail();
    if (u16(local + 6) !== flags || u16(local + 8) !== method) fail();
    const localNameSize = u16(local + 26), start = local + 30 + localNameSize + u16(local + 28);
    if (start + size > directoryStart || decoder.decode(bytes.subarray(local + 30, local + 30 + localNameSize)) !== rawName) fail();
    if (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== size || u32(local + 22) !== plainSize)) fail();
    if (/\.kml$/i.test(name)) {
      const compressed = bytes.subarray(start, start + size);
      const data = method === 8 ? await (options.inflateRaw ?? inflateBrowser)(compressed) : compressed;
      if (data.length !== plainSize || crc32(data) !== crc) fail();
      documents.set(name, decoder.decode(data));
    }
    at += 46 + nameSize + extra + comment;
  }
  if (at !== end) fail();
  const tracks: RawTrack[] = [];
  // Все KML читаются один раз: ссылки лишь проверяются, без fetch и без повторного обхода циклов.
  for (const [name, text] of documents) {
    const root = parseXml(text);
    for (const link of descendants(root, 'NetworkLink')) {
      const href = descendants(link, 'href')[0]?.text.trim();
      if (!href) fail();
      const directory = name.includes('/') ? name.slice(0, name.lastIndexOf('/') + 1) : '';
      if (!documents.has(linkPath(directory, href!))) fail();
    }
    tracks.push(parseKml(`${fileName}/${name}`, text, true).track);
  }
  if (!tracks.some((t) => t.kmlImport?.content)) throw new RouteParseError(ROUTE_ERRORS.empty);
  return tracks;
}

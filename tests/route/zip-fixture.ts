// Только синтетические ZIP, никаких данных путешественника.
import { deflateRawSync } from 'node:zlib';
export function syntheticZip(entries: { name: string; text: string; deflate?: boolean }[]): Uint8Array {
  const locals: Uint8Array[] = [], central: Uint8Array[] = [];
  const concat = (chunks: Uint8Array[]) => { const out = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0)); let at = 0; for (const b of chunks) { out.set(b, at); at += b.length; } return out; };
  const header = (size: number) => {
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    return { bytes, writeUInt32LE: (n: number, at = 0) => view.setUint32(at, n, true), writeUInt16LE: (n: number, at = 0) => view.setUint16(at, n, true) };
  };
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name), plain = new TextEncoder().encode(entry.text), data = entry.deflate ? deflateRawSync(plain) : plain;
    let crc = 0xffffffff;
    for (const byte of plain) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30), c = header(46);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(plain.length, 22); local.writeUInt16LE(name.length, 26);
    c.writeUInt32LE(0x02014b50); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(plain.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(local.bytes, name, data); central.push(c.bytes, name); offset += local.bytes.length + name.length + data.length;
  }
  const directory = concat(central), end = header(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return concat([...locals, directory, end.bytes]);
}

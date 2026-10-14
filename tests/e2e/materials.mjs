// Локальные материалы приёмки: настоящий плеер Edge и декодирование каждого кадра.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { createFile, MP4BoxBuffer, DataStream } from 'mp4box';
import { inspectMp4File } from './mp4.ts';

// Тяжёлые кадры и частные ролики — вне репозитория; каталог переопределяется RS_T15_SCRATCH.
export const SCRATCH = resolve(process.env.RS_T15_SCRATCH ?? resolve(tmpdir(), 'route-story-t15'));
export function saveJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}
export function sha256(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
export async function restrictNetwork(context) {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (['localhost', '127.0.0.1', 'server.arcgisonline.com', 's3.amazonaws.com', 'tiles.openfreemap.org'].includes(url.hostname)
      || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    return route.abort('blockedbyclient');
  });
}
function demux(path) {
  return new Promise((resolvePromise, reject) => {
    const file = createFile();
    const chunks = [];
    let config;
    file.onError = (_module, message) => reject(new Error(message));
    file.onReady = info => {
      const track = info.videoTracks[0];
      const entry = file.getTrackById(track.id).mdia.minf.stbl.stsd.entries[0];
      const ds = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      entry.avcC.write(ds);
      config = { codec: track.codec, codedWidth: track.video.width, codedHeight: track.video.height,
        description: Buffer.from(ds.buffer.slice(8)).toString('base64') };
      file.setExtractionOptions(track.id, null, { nbSamples: track.nb_samples });
      file.start();
    };
    file.onSamples = (_id, _user, samples) => {
      for (const s of samples) chunks.push({ type: s.is_sync ? 'key' : 'delta', timestamp: Math.round(s.cts * 1e6 / s.timescale),
        duration: Math.round(s.duration * 1e6 / s.timescale), data: Buffer.from(s.data).toString('base64') });
    };
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(new Uint8Array(readFileSync(path)).buffer, 0));
    file.flush();
    resolvePromise({ config, chunks });
  });
}

export async function reviewVideo(browser, filePath, shotDir, times) {
  mkdirSync(shotDir, { recursive: true });
  const info = await inspectMp4File(filePath);
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await restrictNetwork(context);
  const page = await context.newPage();
  // Файл отдаётся только локальному плееру через route, не загружается наружу.
  await page.route('http://localhost:4174/__acceptance.mp4', r => r.fulfill({ contentType: 'video/mp4', body: readFileSync(filePath) }));
  await page.route('http://localhost:4174/__review', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Local MP4 review</title><body></body>' }));
  await page.goto('http://localhost:4174/__review');
  await page.evaluate(() => {
    document.body.innerHTML = '<video id="review" controls muted style="width:90vw;height:80vh"></video><canvas id="shot" hidden></canvas>';
    document.querySelector('video').src = '/__acceptance.mp4';
  });
  await page.waitForFunction(() => document.querySelector('video').readyState >= 2);
  const player = await page.evaluate(async () => {
    const v = document.querySelector('video');
    await v.play();
    await new Promise(r => setTimeout(r, 1200));
    v.pause();
    return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, playedTo: v.currentTime, error: v.error?.message ?? null };
  });
  const shots = [];
  for (const t of times) {
    const png = await page.evaluate(async t => {
      const v = document.querySelector('video');
      const target = Math.min(t, v.duration - 1 / 30);
      if (Math.abs(v.currentTime - target) > 0.0001) {
        await new Promise((res, rej) => { const timer = setTimeout(() => rej(new Error('seek timeout')), 20000);
          v.addEventListener('seeked', () => { clearTimeout(timer); res(); }, { once: true }); v.currentTime = target; });
      }
      const c = document.querySelector('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      return c.toDataURL('image/png');
    }, t);
    const path = resolve(shotDir, `t${t.toFixed(3)}.png`);
    writeFileSync(path, Buffer.from(png.split(',')[1], 'base64'));
    shots.push({ t, path, playerSeekTime: await page.evaluate(() => document.querySelector('video').currentTime) });
  }
  const decoded = await page.evaluate(async ({ config, chunks, times }) => {
    const bytes = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
    config.description = bytes(config.description);
    const c = document.createElement('canvas'); c.width = 96; c.height = 96;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const records = [];
    const captures = [];
    const wanted = new Set(times.map(t => Math.round(t * 30)));
    const full = document.createElement('canvas'); full.width = config.codedWidth; full.height = config.codedHeight;
    const fullCtx = full.getContext('2d');
    let previous;
    let decodeError;
    const decoder = new VideoDecoder({ error: e => { decodeError = e.message; }, output: frame => {
      ctx.drawImage(frame, 0, 0, 96, 96);
      const p = ctx.getImageData(0, 0, 96, 96).data;
      let sum = 0, sum2 = 0, diff = 0;
      for (let i = 0; i < p.length; i += 4) {
        const y = (p[i] + p[i + 1] + p[i + 2]) / 3;
        sum += y; sum2 += y * y;
        if (previous) diff += Math.abs(p[i] - previous[i]) + Math.abs(p[i + 1] - previous[i + 1]) + Math.abs(p[i + 2] - previous[i + 2]);
      }
      const mean = sum / (96 * 96);
      records.push({ t: frame.timestamp / 1e6, mean, variance: sum2 / (96 * 96) - mean * mean,
        adjacentMeanDifference: previous ? diff / (96 * 96 * 3) : null });
      if (wanted.has(Math.round(frame.timestamp * 30 / 1e6))) {
        fullCtx.drawImage(frame, 0, 0); captures.push({ t: frame.timestamp / 1e6, png: full.toDataURL('image/png') });
      }
      previous = new Uint8ClampedArray(p); frame.close();
    } });
    decoder.configure(config);
    for (let i = 0; i < chunks.length; i++) {
      decoder.decode(new EncodedVideoChunk({ ...chunks[i], data: bytes(chunks[i].data) }));
      if (decoder.decodeQueueSize > 30) await new Promise(resolve => decoder.addEventListener('dequeue', resolve, { once: true }));
    }
    await decoder.flush(); decoder.close();
    if (decodeError) throw new Error(decodeError);
    const movement = records.filter(r => r.t >= 7 && r.t <= Math.min(22, chunks.length / 30 - 5));
    return { frames: records.length, blankFrames: records.filter(r => r.mean < 2 || r.variance < 1).length,
      movementPairs: movement.length, identicalMovementPairs: movement.filter(r => r.adjacentMeanDifference === 0).length,
      minVariance: Math.min(...records.map(r => r.variance)), records, captures };
  }, { ...await demux(filePath), times });
  // Точные кадры из декодера: seeked в HTMLVideoElement может предшествовать обновлению compositor.
  for (const s of shots) {
    const captured = decoded.captures.find(c => Math.round(c.t * 30) === Math.round(s.t * 30));
    if (!captured) throw new Error(`Не извлечён кадр ${s.t}`);
    writeFileSync(s.path, Buffer.from(captured.png.split(',')[1], 'base64'));
    s.decodedTimestamp = captured.t;
  }
  delete decoded.captures;
  await context.close();
  const result = { file: relative(process.cwd(), resolve(filePath)).split('\\').join('/'), edge: browser.version(), ...info, sha256: sha256(filePath), player, decoded, shots };
  saveJson(resolve(shotDir, 'inspection.json'), result);
  return result;
}

export async function contactSheet(browser, items, path, columns = 3, width = 360, height = 640) {
  const page = await browser.newPage();
  const data = items.map(i => ({ label: i.label, png: readFileSync(i.path).toString('base64') }));
  const png = await page.evaluate(async ({ data, columns, width, height }) => {
    const c = document.createElement('canvas');
    c.width = columns * width; c.height = Math.ceil(data.length / columns) * (height + 32);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#101b2b'; ctx.fillRect(0, 0, c.width, c.height);
    for (let n = 0; n < data.length; n++) {
      const image = new Image(); image.src = 'data:image/png;base64,' + data[n].png; await image.decode();
      const x = n % columns * width, y = Math.floor(n / columns) * (height + 32);
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.fillText(data[n].label, x + 8, y + 21, width - 16);
      const scale = Math.min(width / image.width, height / image.height);
      ctx.drawImage(image, x + (width - image.width * scale) / 2, y + 32, image.width * scale, image.height * scale);
    }
    return c.toDataURL('image/png');
  }, { data, columns, width, height });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.from(png.split(',')[1], 'base64'));
  await page.close();
}

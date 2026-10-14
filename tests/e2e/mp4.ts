// Разбор MP4 через mp4box: размеры, число сэмплов, длительность. Общий для e2e и для scripts/make-exports.mjs
// (Node 24 исполняет .ts напрямую, поэтому здесь нет enum и других конструкций, требующих трансформации).
import { readFileSync } from 'node:fs';
import { createFile, MP4BoxBuffer } from 'mp4box';

export interface Mp4Info {
  width: number;
  height: number;
  samples: number;
  durationSec: number;
  codec: string;
  sizeBytes: number;
}

export function inspectMp4(data: Uint8Array): Promise<Mp4Info> {
  return new Promise((resolve, reject) => {
    const file = createFile();
    file.onError = (_module: string, message: string) => reject(new Error(`mp4box: ${message}`));
    const timer = setTimeout(() => reject(new Error('mp4box: не удалось разобрать файл (нет moov)')), 5000);
    file.onReady = (info) => {
      clearTimeout(timer);
      const track = info.videoTracks[0];
      if (!track) { reject(new Error('В MP4 нет видеодорожки')); return; }
      resolve({
        width: track.video?.width ?? track.track_width,
        height: track.video?.height ?? track.track_height,
        samples: track.nb_samples,
        durationSec: track.duration / track.timescale,
        codec: track.codec,
        sizeBytes: data.byteLength,
      });
    };
    const copy = new Uint8Array(data).buffer; // mp4box забирает буфер себе
    file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(copy, 0));
    file.flush();
  });
}

export function inspectMp4File(path: string): Promise<Mp4Info> {
  return inspectMp4(readFileSync(path));
}

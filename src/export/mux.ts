// Упаковка закодированных кадров: H.264 → MP4 (mp4-muxer, метаданные в начале файла), VP9/VP8 → WebM.
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { FPS } from '../types';
import type { ExportContainer } from './support';

export interface VideoMuxer {
  addChunk(chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata): void;
  finish(): Blob;
}

export interface MuxerSpec { container: ExportContainer; codec: string; width: number; height: number }

export function mimeTypeFor(container: ExportContainer): string {
  return container === 'mp4' ? 'video/mp4' : 'video/webm';
}

export function createMuxer(spec: MuxerSpec): VideoMuxer {
  if (spec.container === 'mp4') {
    const target = new Mp4Target();
    const muxer = new Mp4Muxer({
      target,
      video: { codec: 'avc', width: spec.width, height: spec.height, frameRate: FPS },
      fastStart: 'in-memory',
    });
    return {
      addChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      finish() { muxer.finalize(); return new Blob([target.buffer], { type: mimeTypeFor('mp4') }); },
    };
  }
  const target = new WebmTarget();
  const muxer = new WebmMuxer({
    target,
    video: { codec: spec.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', width: spec.width, height: spec.height, frameRate: FPS },
  });
  return {
    addChunk: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    finish() { muxer.finalize(); return new Blob([target.buffer], { type: mimeTypeFor('webm') }); },
  };
}

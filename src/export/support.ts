// Определение возможностей браузера: WebCodecs, H.264 (MP4) → иначе VP9/VP8 (WebM).
import { DESIGN_SIZE, FPS, type Format } from '../types';

export const EXPORT_BITRATE = 10_000_000;

export type ExportContainer = 'mp4' | 'webm';
export interface ExportSupport { supported: boolean; container: ExportContainer | null; codec: string | null }

/** Кандидаты по убыванию предпочтения: High, Main, Constrained Baseline (level 4.0) → VP9 → VP8. */
export const CODEC_CANDIDATES: { container: ExportContainer; codec: string }[] = [
  { container: 'mp4', codec: 'avc1.640028' },
  { container: 'mp4', codec: 'avc1.4d0028' },
  { container: 'mp4', codec: 'avc1.42e028' },
  { container: 'webm', codec: 'vp09.00.40.08' },
  { container: 'webm', codec: 'vp8' },
];

export const UNSUPPORTED_MESSAGE = 'Экспорт видео работает в Chrome, Edge или Safari 16.4+';

/** Минимум WebCodecs, который нам нужен (подменяется в тестах). */
export interface EncoderApi {
  isConfigSupported(config: VideoEncoderConfig): Promise<{ supported?: boolean }>;
}

export function encoderConfigFor(codec: string, format: Format): VideoEncoderConfig {
  const size = DESIGN_SIZE[format];
  const config: VideoEncoderConfig = {
    codec,
    width: size.width,
    height: size.height,
    bitrate: EXPORT_BITRATE,
    framerate: FPS,
    latencyMode: 'quality',
  };
  if (codec.startsWith('avc1')) config.avc = { format: 'avc' };
  return config;
}

export async function detectExportSupport(
  format: Format,
  api: EncoderApi | undefined = (globalThis as { VideoEncoder?: EncoderApi }).VideoEncoder,
): Promise<ExportSupport> {
  const none: ExportSupport = { supported: false, container: null, codec: null };
  if (!api || typeof api.isConfigSupported !== 'function') return none;
  for (const cand of CODEC_CANDIDATES) {
    try {
      const res = await api.isConfigSupported(encoderConfigFor(cand.codec, format));
      if (res.supported) return { supported: true, container: cand.container, codec: cand.codec };
    } catch {
      // кодек отвергнут — пробуем следующий
    }
  }
  return none;
}

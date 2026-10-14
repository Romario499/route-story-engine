import { describe, expect, it } from 'vitest';
import { detectExportSupport, type EncoderApi } from '../../src/export/support';

/** Энкодер, поддерживающий только перечисленные кодеки. */
const apiWith = (...codecs: string[]): EncoderApi => ({
  isConfigSupported: async (c) => ({ supported: codecs.includes(c.codec) }),
});

describe('detectExportSupport', () => {
  it('предпочитает H.264 High → MP4', async () => {
    expect(await detectExportSupport('9:16', apiWith('avc1.640028', 'vp8'))).toEqual({ supported: true, container: 'mp4', codec: 'avc1.640028' });
  });
  it('перебирает профили H.264: Main, потом Constrained Baseline', async () => {
    expect((await detectExportSupport('16:9', apiWith('avc1.4d0028'))).codec).toBe('avc1.4d0028');
    expect((await detectExportSupport('16:9', apiWith('avc1.42e028'))).codec).toBe('avc1.42e028');
  });
  it('без H.264 — VP9 в WebM, затем VP8', async () => {
    expect(await detectExportSupport('9:16', apiWith('vp09.00.40.08', 'vp8'))).toEqual({ supported: true, container: 'webm', codec: 'vp09.00.40.08' });
    expect(await detectExportSupport('9:16', apiWith('vp8'))).toEqual({ supported: true, container: 'webm', codec: 'vp8' });
  });
  it('ничего не поддерживается или нет WebCodecs → supported: false', async () => {
    const none = { supported: false, container: null, codec: null };
    expect(await detectExportSupport('9:16', apiWith())).toEqual(none);
    expect(await detectExportSupport('9:16', undefined)).toEqual(none);
  });
  it('проверяет конфиг ровно под размер формата', async () => {
    const seen: { w: number; h: number }[] = [];
    const api: EncoderApi = { isConfigSupported: async (c) => { seen.push({ w: c.width, h: c.height }); return { supported: true }; } };
    await detectExportSupport('9:16', api);
    await detectExportSupport('16:9', api);
    expect(seen).toEqual([{ w: 1080, h: 1920 }, { w: 1920, h: 1080 }]);
  });
  it('исключение из isConfigSupported не ломает перебор', async () => {
    const api: EncoderApi = { isConfigSupported: async (c) => { if (c.codec.startsWith('avc1')) throw new TypeError('x'); return { supported: c.codec === 'vp8' }; } };
    expect((await detectExportSupport('9:16', api)).codec).toBe('vp8');
  });
});

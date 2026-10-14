import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ensureFonts держит кэш в модуле — каждому тесту свежий модуль и свой document.fonts.
type LoadImpl = (spec: string, text?: string) => Promise<unknown[]>;

function installFonts(opts: { load?: LoadImpl; check?: (spec: string) => boolean } = {}) {
  const load = vi.fn<LoadImpl>(opts.load ?? (async () => [{}]));
  const check = vi.fn((spec: string) => (opts.check ? opts.check(spec) : true));
  (globalThis as { document?: unknown }).document = { fonts: { load, check, ready: Promise.resolve() } };
  return { load, check };
}

async function freshModule() {
  vi.resetModules();
  return import('../../src/render/fonts');
}

describe('строгая загрузка шрифтов', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });

  it('отказ загрузки Manrope → FontLoadError с именем гарнитуры, готовность ложна', async () => {
    installFonts({ load: async (spec) => { if (spec.includes('Manrope')) throw new Error('NetworkError'); return [{}]; } });
    const { ensureFonts, fontsReady, FontLoadError } = await freshModule();
    const err = await ensureFonts().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(FontLoadError);
    expect((err as InstanceType<typeof FontLoadError>).family).toBe('Manrope');
    expect((err as Error).message).toContain('Manrope');
    expect(fontsReady()).toBe(false);
  });

  it('повтор после отказа снова пытается загрузить и успешен', async () => {
    let broken = true;
    const { load } = installFonts({ load: async () => { if (broken) throw new Error('NetworkError'); return [{}]; } });
    const { ensureFonts, fontsReady } = await freshModule();
    await expect(ensureFonts()).rejects.toThrow();
    const callsAfterFail = load.mock.calls.length;
    broken = false;
    await expect(ensureFonts()).resolves.toBeUndefined();
    expect(load.mock.calls.length).toBeGreaterThan(callsAfterFail);
    expect(fontsReady()).toBe(true);
  });

  it('успех кэшируется: второй вызов не обращается к document.fonts', async () => {
    const { load } = installFonts();
    const { ensureFonts, fontsReady } = await freshModule();
    expect(fontsReady()).toBe(false);
    await ensureFonts();
    const calls = load.mock.calls.length;
    await ensureFonts();
    expect(load.mock.calls.length).toBe(calls);
    expect(fontsReady()).toBe(true);
  });

  it('грузит все обязательные начертания: Manrope 500/600/700/800, PT Serif 400/700, JetBrains Mono 500', async () => {
    const { load, check } = installFonts();
    const { ensureFonts } = await freshModule();
    await ensureFonts();
    const loaded = load.mock.calls.map(([s]) => s);
    for (const spec of ["500 24px 'Manrope'", "600 24px 'Manrope'", "700 24px 'Manrope'", "800 24px 'Manrope'",
      "400 24px 'PT Serif'", "700 24px 'PT Serif'", "500 24px 'JetBrains Mono'"]) {
      expect(loaded).toContain(spec);
      expect(check.mock.calls.map(([s]) => s)).toContain(spec);
    }
  });

  it('check() = false после успешного load → FontLoadError', async () => {
    installFonts({ check: (spec) => !spec.includes('PT Serif') });
    const { ensureFonts, FontLoadError } = await freshModule();
    const err = await ensureFonts().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(FontLoadError);
    expect((err as InstanceType<typeof FontLoadError>).family).toBe('PT Serif');
  });

  it('гарнитура не объявлена (load вернул пустой список) → FontLoadError, а не тихая подмена', async () => {
    installFonts({ load: async (spec) => (spec.includes('JetBrains Mono') ? [] : [{}]) });
    const { ensureFonts, FontLoadError } = await freshModule();
    const err = await ensureFonts().then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(FontLoadError);
    expect((err as InstanceType<typeof FontLoadError>).family).toBe('JetBrains Mono');
  });

  it('параллельные вызовы делят одну загрузку', async () => {
    const { load } = installFonts();
    const { ensureFonts } = await freshModule();
    const a = ensureFonts(); const b = ensureFonts();
    await Promise.all([a, b]);
    const per = load.mock.calls.length;
    expect(per).toBeGreaterThan(0);
    await ensureFonts();
    expect(load.mock.calls.length).toBe(per);
    // одна волна загрузки: каждое начертание грузилось один раз
    const specs = load.mock.calls.map(([s]) => s);
    expect(new Set(specs).size).toBe(specs.length);
  });

  describe('зависший document.fonts.load', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('через 15 с — FontLoadError(Manrope) и сброс кэша; повтор после этого успешен', async () => {
      vi.useFakeTimers();
      let hang = true;
      const { load } = installFonts({ load: (spec) => (hang && spec.includes('Manrope') ? new Promise<unknown[]>(() => {}) : Promise.resolve([{}])) });
      const { ensureFonts, fontsReady, FontLoadError, FONT_LOAD_TIMEOUT_MS } = await freshModule();
      expect(FONT_LOAD_TIMEOUT_MS).toBe(15_000);
      let settled: unknown = 'pending';
      ensureFonts().then(() => { settled = 'ok'; }, (e: unknown) => { settled = e; });
      await vi.advanceTimersByTimeAsync(14_900);
      expect(settled).toBe('pending');
      await vi.advanceTimersByTimeAsync(200);
      expect(settled).toBeInstanceOf(FontLoadError);
      expect((settled as InstanceType<typeof FontLoadError>).family).toBe('Manrope');
      expect(fontsReady()).toBe(false);

      hang = false;
      const calls = load.mock.calls.length;
      await expect(ensureFonts()).resolves.toBeUndefined();
      expect(load.mock.calls.length).toBeGreaterThan(calls);
      expect(fontsReady()).toBe(true);
    });

    it('зависшая переходная гарнитура (Unbounded) не блокирует и не ломает: итог — успех через 15 с', async () => {
      vi.useFakeTimers();
      installFonts({ load: (spec) => (spec.includes('Unbounded') ? new Promise<unknown[]>(() => {}) : Promise.resolve([{}])) });
      const { ensureFonts } = await freshModule();
      let settled: unknown = 'pending';
      ensureFonts().then(() => { settled = 'ok'; }, (e: unknown) => { settled = e; });
      await vi.advanceTimersByTimeAsync(15_100);
      expect(settled).toBe('ok');
    });
  });

  describe('пересоздание таблиц стилей перед повтором (отказавший FontFace сам не перезагружается)', () => {
    class FakeLink {
      parentNode = { insertBefore: vi.fn() };
      remove = vi.fn();
      clone: FakeLink | null = null;
      addEventListener(type: string, fn: () => void) { if (type === 'load') queueMicrotask(fn); }
      cloneNode() { this.clone = new FakeLink(); return this.clone; }
    }
    class FakeFontRule {}
    class FakeImportRule {}
    class FakeStyleRule {}

    afterEach(() => {
      for (const k of ['HTMLLinkElement', 'CSSFontFaceRule', 'CSSImportRule']) delete (globalThis as Record<string, unknown>)[k];
    });

    function setup(broken: { value: boolean }) {
      const g = globalThis as Record<string, unknown>;
      g.HTMLLinkElement = FakeLink; g.CSSFontFaceRule = FakeFontRule; g.CSSImportRule = FakeImportRule;
      const fontsLink = new FakeLink();
      const plainLink = new FakeLink();
      installFonts({ load: async (spec) => { if (broken.value && spec.includes('Manrope')) throw new Error('NetworkError'); return [{}]; } });
      (g.document as Record<string, unknown>).styleSheets = [
        { ownerNode: fontsLink, cssRules: [new FakeStyleRule(), new FakeFontRule()] },
        { ownerNode: plainLink, cssRules: [new FakeStyleRule()] },
      ];
      return { fontsLink, plainLink };
    }

    it('после отказа следующий вызов подменяет только таблицу с @font-face и старую убирает', async () => {
      const broken = { value: true };
      const { fontsLink, plainLink } = setup(broken);
      const { ensureFonts } = await freshModule();
      await expect(ensureFonts()).rejects.toThrow();
      expect(fontsLink.parentNode.insertBefore).not.toHaveBeenCalled(); // при первой попытке стили не трогаем
      broken.value = false;
      await expect(ensureFonts()).resolves.toBeUndefined();
      expect(fontsLink.parentNode.insertBefore).toHaveBeenCalledTimes(1);
      expect(fontsLink.parentNode.insertBefore.mock.calls[0][0]).toBe(fontsLink.clone);
      expect(fontsLink.remove).toHaveBeenCalledTimes(1);
      expect(plainLink.parentNode.insertBefore).not.toHaveBeenCalled();
      expect(plainLink.remove).not.toHaveBeenCalled();
    });
  });
});

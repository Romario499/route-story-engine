// Проба в настоящем браузере (история 115): строгая загрузка шрифтов при отключённом кэше, медленной загрузке и 404.
//   node tests/render/fonts-probe.mjs
// Собирает сайт (dist/) и src/render/fonts.ts в один скрипт, поднимает vite preview на порту 4176,
// открывает страницу в Edge (RS_E2E_CHANNEL=chrome — Chrome) и перехватывает запрос файла Manrope.
// Код выхода 0 — все сценарии прошли.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = 4176;
const URL_ = `http://localhost:${PORT}/`;
const CHANNEL = process.env.RS_E2E_CHANNEL ?? 'msedge';
const SLOW_MS = 2500;
const MANROPE = '**/Manrope_wght_*.ttf';

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Сервер ${url} не поднялся за ${ms / 1000} с`);
}

// 1. сайт и отдельный скрипт с fonts.ts (window.RSFonts)
const r = spawnSync('npx vite build', { cwd: root, stdio: 'ignore', shell: true });
if (r.status !== 0) throw new Error('vite build не прошла');
const probeDir = resolve(root, 'node_modules/.cache/fonts-probe');
await build({
  root, configFile: false, logLevel: 'silent',
  build: {
    outDir: probeDir, emptyOutDir: true, minify: false,
    lib: { entry: resolve(root, 'src/render/fonts.ts'), name: 'RSFonts', formats: ['iife'], fileName: () => 'fonts.js' },
  },
});
const bundle = readFileSync(resolve(probeDir, 'fonts.js'), 'utf8');

const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
const results = [];
let browser;
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

/** Новая страница с отключённым кэшем (CDP) и подключённым RSFonts. */
async function openPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  return { context, page };
}
async function boot(page) {
  await page.goto(URL_);
  await page.addScriptTag({ content: bundle });
}
const run = (page, fn) => page.evaluate(fn);

try {
  await waitForServer(URL_, 30_000);
  browser = await chromium.launch({ channel: CHANNEL, headless: process.env.RS_E2E_HEADED !== '1' });

  // A. норма при отключённом кэше
  {
    const { context, page } = await openPage();
    await boot(page);
    const out = await run(page, async () => {
      await window.RSFonts.ensureFonts();
      return { ready: window.RSFonts.fontsReady(), manrope: document.fonts.check("700 24px 'Manrope'", 'Жж Aa') };
    });
    check('норма, кэш отключён: ensureFonts успешен', out.ready && out.manrope, JSON.stringify(out));
    await context.close();
  }

  // B. медленная загрузка файла: ensureFonts дожидается, а не сдаётся
  {
    const { context, page } = await openPage();
    await page.route(MANROPE, async (route) => { await new Promise((ok) => setTimeout(ok, SLOW_MS)); await route.continue(); });
    await boot(page);
    const out = await run(page, async () => {
      const t0 = performance.now();
      await window.RSFonts.ensureFonts();
      return { ms: Math.round(performance.now() - t0), ready: window.RSFonts.fontsReady() };
    });
    check(`медленная загрузка (${SLOW_MS} мс): ensureFonts дождался`, out.ready && out.ms >= SLOW_MS - 300, `${out.ms} мс`);
    await context.close();
  }

  // C. 404 файла: отказ FontLoadError, затем повтор после восстановления
  {
    const { context, page } = await openPage();
    await page.route(MANROPE, (route) => route.fulfill({ status: 404, body: 'not found' }));
    await boot(page);
    const failed = await run(page, async () => {
      try { await window.RSFonts.ensureFonts(); return { threw: false }; } catch (e) {
        return { threw: true, isFontLoadError: e instanceof window.RSFonts.FontLoadError, family: e.family, message: e.message, ready: window.RSFonts.fontsReady() };
      }
    });
    check('404: reject FontLoadError(Manrope), fontsReady = false',
      failed.threw && failed.isFontLoadError && failed.family === 'Manrope' && failed.ready === false, JSON.stringify(failed));

    const failedAgain = await run(page, async () => {
      try { await window.RSFonts.ensureFonts(); return false; } catch { return true; }
    });
    check('404 сохраняется: повтор снова отвергается (кэш неудачи не залипает как успех)', failedAgain);

    await page.unroute(MANROPE);
    const recovered = await run(page, async () => {
      try { await window.RSFonts.ensureFonts(); return { ok: true, ready: window.RSFonts.fontsReady(), manrope: document.fonts.check("800 24px 'Manrope'", 'Жж Aa') }; }
      catch (e) { return { ok: false, error: String(e.message) }; }
    });
    check('после восстановления файла повтор успешен', recovered.ok && recovered.ready && recovered.manrope, JSON.stringify(recovered));
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  server.kill();
}

const failed = results.filter((x) => !x.ok).length;
console.log(`\n${results.length - failed}/${results.length} сценариев прошли`);
process.exitCode = failed ? 1 : 0;

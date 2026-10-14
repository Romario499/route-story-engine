// Снимает готовые ролики продуктом: тот же путь через интерфейс, что и у пользователя (настоящий Edge/Chrome).
//   npm run exports — собирает сайт, поднимает vite preview, снимает матрицу T15 в exports/redesign/.
// Старые ролики защищены хешами, новые — от перезаписи. Кадры и тяжёлые факты — в scratchpad T15.
// Нужен интернет (тайлы карты) и установленный Edge (или RS_E2E_CHANNEL=chrome).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { configure, exportAndDownload, ExportWarningError, openAndLoadSample } from '../tests/e2e/flow.ts';
import { inspectMp4 } from '../tests/e2e/mp4.ts';
import { SCRATCH, restrictNetwork, reviewVideo, saveJson, sha256 } from '../tests/e2e/materials.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'exports/redesign');
const PORT = 4174;
const URL_ = `http://localhost:${PORT}/`;
const MAX_BYTES = 50 * 1024 * 1024;
const CHANNEL = process.env.RS_E2E_CHANNEL ?? 'msedge';

const JOBS = [
  { file: 'expedition-9x16-ru.mp4', opts: { style: 'epic', format: '9x16', duration: 30, lang: 'ru' }, size: [1080, 1920] },
  { file: 'expedition-16x9-en.mp4', opts: { style: 'epic', format: '16x9', duration: 30, lang: 'en' }, size: [1920, 1080] },
  { file: 'atlas-9x16-en.mp4', opts: { style: 'atlas', format: '9x16', duration: 30, lang: 'en' }, size: [1080, 1920] },
  { file: 'atlas-16x9-ru.mp4', opts: { style: 'atlas', format: '16x9', duration: 30, lang: 'ru' }, size: [1920, 1080] },
  { file: 'check/neon-9x16-ru.mp4', opts: { style: 'neon', format: '9x16', duration: 15, lang: 'ru' }, size: [1080, 1920] },
  { file: 'check/neon-16x9-en.mp4', opts: { style: 'neon', format: '16x9', duration: 15, lang: 'en' }, size: [1920, 1080] },
];
const selectedJobs = JOBS.filter(j => !process.env.RS_EXPORT_ONLY || j.file.includes(process.env.RS_EXPORT_ONLY));
if (!selectedJobs.length) throw new Error('RS_EXPORT_ONLY не соответствует матрице');
const oldFiles = ['route-story-wahrier-9x16.mp4', 'route-story-wahrier-16x9.mp4'];
const oldHashes = Object.fromEntries(oldFiles.map(f => [f, sha256(resolve(root, 'exports', f))]));
saveJson(resolve(SCRATCH, 'old-exports-before.json'), oldHashes);

function run(cmd, args) {
  const r = spawnSync([cmd, ...args].join(' '), { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} завершилась с кодом ${r.status}`);
}

async function waitForServer(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return; } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Сервер ${url} не поднялся за ${ms / 1000} с`);
}

run('npm', ['run', 'build']);
mkdirSync(outDir, { recursive: true });

const server = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
let failed = false;
const report = [];
try {
  await waitForServer(URL_, 30_000);
  const browser = await chromium.launch({ channel: CHANNEL, headless: process.env.RS_E2E_HEADED !== '1', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    for (const job of selectedJobs) {
      const target = resolve(outDir, job.file);
      if (existsSync(target)) {
        if (process.env.RS_EXPORT_REVIEW_EXISTING !== '1') throw new Error(`Файл уже существует: ${job.file}; перезапись не разрешена`);
        const previousReport = target.replace('.mp4', '.json');
        const exportSec = existsSync(previousReport) ? JSON.parse(readFileSync(previousReport, 'utf8')).exportSec : null;
        const times = job.opts.duration === 30 ? [0, 2, 10, 10 + 1 / 30, 15, 20, 28, 29 + 29 / 30] : [0, 2, 7, 7 + 1 / 30, 13, 14 + 29 / 30];
        const review = await reviewVideo(browser, target, resolve(SCRATCH, 'videos', job.file.replace('.mp4', '')), times);
        saveJson(previousReport, { ...review, opts: job.opts, exportSec, decoded: { ...review.decoded, records: undefined }, shots: review.shots.map(s => ({ t: s.t })) });
        if (review.width !== job.size[0] || review.height !== job.size[1] || !review.codec.startsWith('avc1.')
          || Math.abs(review.durationSec - job.opts.duration) > 0.2 || review.sizeBytes > MAX_BYTES
          || review.decoded.blankFrames || review.decoded.frames !== job.opts.duration * 30) throw new Error('Файл не соответствует матрице/декодированию');
        report.push(`Проверен существующий новый файл ${job.file}: ${review.decoded.frames} кадров`);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      let done = false;
      for (let attempt = 1; attempt <= 2 && !done; attempt++) {
        const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1400, height: 1000 } });
        await restrictNetwork(context);
        const page = await context.newPage();
        try {
          console.log(`\n== ${job.file} (попытка ${attempt}): ${JSON.stringify(job.opts)}`);
          await openAndLoadSample(page, URL_);
          await configure(page, job.opts);
          const started = Date.now();
          let exported;
          try {
            exported = await exportAndDownload(page);
          } catch (e) {
            // «готово с предупреждением»: карта на части кадров не догрузилась — файл не годится, снимаем заново
            if (e instanceof ExportWarningError) { console.warn(`ПРОБЛЕМА (${e.warning}) — ${job.file}, попытка ${attempt}`); continue; }
            throw e;
          }
          const { data } = exported;
          const info = await inspectMp4(data);
          const frames = job.opts.duration * 30;
          const problems = [];
          if (!info.codec.startsWith('avc1.')) problems.push(`кодек ${info.codec}, ожидался H.264`);
          if (info.width !== job.size[0] || info.height !== job.size[1]) problems.push(`размер ${info.width}×${info.height}`);
          if (info.samples !== frames) problems.push(`сэмплов ${info.samples}, ожидалось ${frames}`);
          if (Math.abs(info.durationSec - job.opts.duration) > 0.2) problems.push(`длительность ${info.durationSec.toFixed(2)} с`);
          if (info.sizeBytes > MAX_BYTES) problems.push(`размер файла ${(info.sizeBytes / 1048576).toFixed(1)} МБ > 50 МБ`);
          const line = `${job.file}: ${info.width}×${info.height}, ${info.samples} сэмплов, ${info.durationSec.toFixed(2)} с, ${(info.sizeBytes / 1048576).toFixed(1)} МБ, ${info.codec}`;
          if (problems.length) { console.warn(`ПРОБЛЕМА (${problems.join('; ')}) — ${line}`); continue; }
          writeFileSync(target, data);
          const exportSec = (Date.now() - started) / 1000;
          const times = job.opts.duration === 30 ? [0, 2, 10, 10 + 1 / 30, 15, 20, 28, 29 + 29 / 30] : [0, 2, 7, 7 + 1 / 30, 13, 14 + 29 / 30];
          const review = await reviewVideo(browser, target, resolve(SCRATCH, 'videos', job.file.replace('.mp4', '')), times);
          saveJson(resolve(outDir, job.file.replace('.mp4', '.json')), { ...review, opts: job.opts, exportSec, decoded: { ...review.decoded, records: undefined }, shots: review.shots.map(s => ({ t: s.t })) });
          if (review.decoded.blankFrames || review.decoded.frames !== frames || review.player.error) throw new Error('Ошибка декодирования/пустые кадры — см. inspection.json');
          console.log(`OK ${line}`);
          report.push(line);
          done = true;
        } finally {
          await context.close();
        }
      }
      if (!done) { failed = true; console.error(`Не удалось снять ${job.file}`); }
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
console.log('\nИтог mp4box:\n' + report.join('\n'));
for (const [f, hash] of Object.entries(oldHashes)) if (sha256(resolve(root, 'exports', f)) !== hash) throw new Error(`Старый экспорт изменился: ${f}`);
process.exit(failed ? 1 : 0);

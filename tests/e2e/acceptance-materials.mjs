// T15: сбор фактов без правок src и без публикации. Node >= 22.18, установленный Edge.
// node tests/e2e/acceptance-materials.mjs ui|frames|data|local
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { chromium } from '@playwright/test';
import { openAndLoadSample, configure, exportAndDownload, ExportWarningError } from './flow.ts';
import { SCRATCH, contactSheet, restrictNetwork, reviewVideo, saveJson } from './materials.mjs';

const root = process.cwd();
const phase = process.argv[2];
const url = 'http://localhost:5184/';
const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--port', '5184', '--strictPort'], { cwd: root, stdio: 'ignore' });
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
await restrictNetwork(context);
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const facts = { phase, edge: browser.version(), started: new Date().toISOString(), errors };
mkdirSync(SCRATCH, { recursive: true });
const shot = async (name, p = page) => {
  const path = resolve(SCRATCH, phase, name + '.png'); mkdirSync(resolve(SCRATCH, phase), { recursive: true });
  await p.screenshot({ path, fullPage: true }); return path;
};
const ready = async () => {
  await page.waitForFunction(() => Boolean(window.__rs?.scene && window.__rs?.timeline) && document.querySelector('.preview__loading')?.hidden !== false, null, { timeout: 90000 });
  if (await page.getByTestId('play').evaluate(el => el.classList.contains('is-playing'))) await page.getByTestId('play').click();
};
const sizes = [[1440,900], [1920,1080], [1024,768], [390,844], [360,740]];
const countActions = async () => page.evaluate(() => {
  window.__acceptanceActions=[];
  document.addEventListener('change',e=>{if(e.target.matches('[data-testid="file-input"]'))window.__acceptanceActions.push('file-selection');},{capture:true});
  document.addEventListener('click',e=>{const el=e.target.closest('[data-testid]');if(['export','section-advanced'].includes(el?.dataset.testid))window.__acceptanceActions.push(el.dataset.testid);},{capture:true});
});
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break; } catch { } await new Promise(r => setTimeout(r, 300)); }
  if (phase === 'ui') {
    const matrix = [];
    const capture = async state => {
      for (const [w,h] of sizes) {
        await page.setViewportSize({ width:w, height:h }); await page.waitForTimeout(250);
        const metrics = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          export: document.querySelector('[data-testid="export"], [data-testid="export-cancel"], [data-testid="download"]')?.getBoundingClientRect().toJSON(),
          titleWarning: document.querySelector('[data-testid="title-warning"]')?.hidden === false,
          bodyScrollHeight: document.documentElement.scrollHeight }));
        matrix.push({ state, w, h, ...metrics, path: await shot(`${w}-${state}`) });
      }
    };
    await page.goto(url); await capture('empty');
    await page.getByTestId('file-input').setInputFiles(resolve('tests/fixtures/synthetic/synthetic-broken.gpx'));
    await page.getByTestId('route-error').waitFor(); await capture('error');
    await openAndLoadSample(page, url); await ready(); await capture('loaded');
    await page.getByTestId('title-input').fill('Очень длинное название синтетического путешествия через множество городов и стран без сокращений');
    await page.getByTestId('author-input').fill('Синтетический автор с очень длинной подписью для проверки компоновки');
    await capture('long-ru');
    await page.getByTestId('lang-en').click();
    await page.getByTestId('title-input').fill('A very long synthetic journey title across many cities and countries without abbreviations');
    await capture('long-en');
    await page.getByTestId('title-input').fill(''); await page.getByTestId('author-input').fill('@wahrier · реконструкция маршрута');
    await page.getByTestId('lang-ru').click(); await page.getByTestId('duration-15').click();
    await page.getByTestId('export').click(); await page.getByTestId('export-progress').waitFor();
    await capture('export'); await page.getByTestId('export-cancel').click();
    await page.getByTestId('export').waitFor({ timeout:30000 }); await capture('cancel');
    const result = await exportAndDownload(page); const file = resolve(SCRATCH, 'ui', 'after-cancel.mp4'); writeFileSync(file,result.data);
    await capture('done');
    facts.review = await reviewVideo(browser, file, resolve(SCRATCH,'ui','after-cancel'), [2,7,13,14+29/30]);
    facts.matrix = matrix;
    for (const [w] of sizes) await contactSheet(browser, matrix.filter(x => x.w===w).map(x=>({label:x.state,path:x.path})),
      resolve('docs/visual-review/ui-matrix',`${w}.png`), 4, w < 500 ? 270 : 360, 500);
    await contactSheet(browser, [{label:'До, 1440',path:resolve('docs/visual-review/before/ui-1440-loaded.png')},
      {label:'После, 1440',path:matrix.find(x=>x.w===1440&&x.state==='loaded').path},
      {label:'До, 390',path:resolve('docs/visual-review/before/ui-390-loaded.png')},
      {label:'После, 390',path:matrix.find(x=>x.w===390&&x.state==='loaded').path}], resolve('docs/visual-review/after/ui-before-after.png'), 2, 560, 680);
  } else if (phase === 'frames') {
    await openAndLoadSample(page,url); await ready();
    facts.combinations = [];
    for (const style of ['epic','atlas']) for (const format of ['9x16','16x9']) for (const lang of ['ru','en']) {
      await configure(page,{style,format,lang,duration:30}); await ready(); await page.waitForTimeout(1000);
      const key = `${style}-${format}-${lang}`;
      const captured = await page.evaluate(async () => {
        const rs = window.__rs; const times = [2,10,20,28]; const out=[];
        await rs.scene.render(rs.timeline.frameAt(0),{waitForTiles:true,timeoutMs:30000});
        for (let i=1; i<=840; i++) {
          const t=i/30;
          await rs.scene.render(rs.timeline.frameAt(t),{waitForTiles:times.includes(t),timeoutMs:30000});
          if(times.includes(t)) out.push({t,png:rs.scene.canvas.toDataURL('image/png')});
        }
        return out;
      });
      const row={key, comparisons:[], sheets:[]};
      for (const s of captured) {
        const p=resolve(SCRATCH,'frames',`${key}-sequence-${s.t}.png`); mkdirSync(resolve(SCRATCH,'frames'),{recursive:true});
        writeFileSync(p,Buffer.from(s.png.split(',')[1],'base64'));
        // Реальный slider input; снимок после готовности сцены, без подмены timeline.
        await page.getByTestId('seek').evaluate((el,t)=>{el.value=String(t/30*1000);el.dispatchEvent(new Event('input',{bubbles:true}));},s.t);
        await page.waitForTimeout(150);
        const seek=await page.evaluate(async t=>{const rs=window.__rs; const r=await rs.scene.render(rs.timeline.frameAt(t),{waitForTiles:true,timeoutMs:30000});return {png:rs.scene.canvas.toDataURL('image/png'),tilesComplete:r.tilesComplete};},s.t);
        const sp=resolve(SCRATCH,'frames',`${key}-seek-${s.t}.png`);writeFileSync(sp,Buffer.from(seek.png.split(',')[1],'base64'));
        const diff=await page.evaluate(async({a,b})=>{const c=document.createElement('canvas');c.width=160;c.height=160;const ctx=c.getContext('2d',{willReadFrequently:true});const pixels=[];
          for(const src of[a,b]){const im=new Image();im.src=src;await im.decode();ctx.drawImage(im,0,0,160,160);pixels.push(ctx.getImageData(0,0,160,160).data);}let sum=0;for(let i=0;i<pixels[0].length;i++)sum+=Math.abs(pixels[0][i]-pixels[1][i]);return sum/pixels[0].length;},{a:s.png,b:seek.png});
        row.comparisons.push({t:s.t,seekMeanAbsoluteDifference:diff,tilesComplete:seek.tilesComplete});
        row.sheets.push({label:`${key} t=${s.t} seek`,path:sp});
      }
      await contactSheet(browser,row.sheets.filter(x=>!x.label.includes('t=20')),resolve('docs/visual-review/after',`${key}.png`),3,format==='9x16'?300:480,format==='9x16'?534:270);
      const videoName=(style==='epic'?'expedition':'atlas')+'-'+format+'-'+lang;
      const videoDir=resolve(SCRATCH,'videos',videoName);
      try {
        const pairs=[];
        for(const s of captured) pairs.push({label:`Preview t=${s.t}`,path:resolve(SCRATCH,'frames',`${key}-seek-${s.t}.png`)},{label:`MP4 t=${s.t}`,path:resolve(videoDir,`t${s.t.toFixed(3)}.png`)});
        await contactSheet(browser,pairs,resolve('docs/visual-review/preview-vs-export',`${key}.png`),2,format==='9x16'?300:480,format==='9x16'?534:270);
        row.exportComparison='paired actual frames';
      } catch(e) { row.exportComparison='нет MP4 на этом языке в матрице'; }
      facts.combinations.push(row); console.log('frames',key,row.comparisons.map(c=>c.seekMeanAbsoluteDifference.toFixed(3)).join(','));
    }
  } else if (phase === 'data') {
    facts.routes=existsSync(resolve(SCRATCH,'data.json')) ? JSON.parse(readFileSync(resolve(SCRATCH,'data.json'),'utf8')).routes ?? [] : [];
    const files=readdirSync(resolve('tests/fixtures/synthetic')).filter(f=>f.endsWith('.gpx')).map(f=>resolve('tests/fixtures/synthetic',f));
    let densePoints='';for(let i=0;i<6000;i++)densePoints+=`<trkpt lat="${46+i*0.00001}" lon="${9+i*0.00001}"/>`;
    const densePath=resolve(SCRATCH,'synthetic-dense-6000.gpx');writeFileSync(densePath,`<gpx><trk><name>синтетика 6000 точек</name><trkseg>${densePoints}</trkseg></trk></gpx>`);files.push(densePath);
    files.push(...['triglav.gpx','trecime.GPX','MontBuetChevalBlanc.GPX'].map(f=>resolve('tracks',f)));
    for (const file of files) {
      if(facts.routes.some(r=>r.file===basename(file))) continue;
      await page.goto(url); await countActions(); const started=Date.now();
      await page.getByTestId('file-input').setInputFiles(file);
      await page.getByTestId('route-summary').or(page.getByTestId('route-error')).waitFor({timeout:90000});
      const item={file:basename(file),importUiSec:(Date.now()-started)/1000,private:file.includes('tracks')};
      if(await page.getByTestId('route-error').isVisible()) item.error=await page.getByTestId('route-error').innerText();
      else {
        await ready(); item.previewReadySec=(Date.now()-started)/1000;
        item.actionsToPreview=await page.evaluate(()=>window.__acceptanceActions);
        await page.getByTestId('duration-15').click(); await ready();
        let result; item.exportWarnings=[];
        const before=Date.now();
        for(let attempt=1;attempt<=2;attempt++) {
          try {result=await exportAndDownload(page);break;} catch(e) {
            if(!(e instanceof ExportWarningError)) throw e;
            item.exportWarnings.push(e.warning);console.log('WARN',item.file,e.warning);
          }
        }
        item.exportSec=(Date.now()-before)/1000;
        if(!result) {facts.routes.push(item);saveJson(resolve(SCRATCH,'data.json'),facts);continue;}
        const out=resolve(SCRATCH,'data',basename(file)+'.mp4');mkdirSync(resolve(SCRATCH,'data'),{recursive:true});writeFileSync(out,result.data);
        const review=await reviewVideo(browser,out,resolve(SCRATCH,'data',basename(file)),[0,2,7,13,14+29/30]);
        item.review={...review,decoded:{...review.decoded,records:undefined}};
        item.actionsToMp4=await page.evaluate(()=>window.__acceptanceActions);
      }
      facts.routes.push(item);saveJson(resolve(SCRATCH,'data.json'),facts);console.log('data',item.file,item.error??`${item.importUiSec}s import / ${item.exportSec}s export`);
    }
    // Замер чистого публичного шва parseRouteText/buildRoute: без сети, без отрисовки.
    facts.benchmark=await page.evaluate(async()=>{
      const {parseRouteText,buildRoute}=await import('/src/route/index.ts');const results=[];
      const sample=await(await fetch('/samples/wahrier-reconstruction.gpx')).text();
      let points='';for(let i=0;i<200000;i++)points+=`<trkpt lat="${45+i*0.000001}" lon="${10+i*0.000001}"><time>${new Date(1700000000000+i*1000).toISOString()}</time></trkpt>`;
      for(const[name,text]of[['sample',sample],['synthetic-200000',`<gpx><trk><name>синтетика 200000</name><trkseg>${points}</trkseg></trk></gpx>`]]){
        const start=performance.now();const p=parseRouteText(name+'.gpx',text);const parsedMs=performance.now()-start;const r=buildRoute(p.tracks);
        results.push({name,parsedMs,parseAndBuildMs:performance.now()-start,points:r.points?.length,error:r.error??null});
      }return results;
    });
    facts.gaps=[];
    for(const name of ['synthetic-gap-50km.gpx','synthetic-sparse-logger.gpx','synthetic-city-14km.gpx']) {
      const r=await page.evaluate(async({name,text})=>{const {parseRouteText,buildRoute}=await import('/src/route/index.ts');const p=parseRouteText(name,text);const r=buildRoute(p.tracks);return {points:r.points.length,totalM:r.totalM,ownM:r.ownM,transfers:r.transfers.length};},{name,text:readFileSync(resolve('tests/fixtures/synthetic',name),'utf8')});
      facts.gaps.push({name,...r});
    }
  } else if (phase === 'local') {
    // Уже снятые оркестратором материалы остаются на месте; только локальное открытие и факты.
    facts.local=existsSync(resolve(SCRATCH,'local.json')) ? JSON.parse(readFileSync(resolve(SCRATCH,'local.json'),'utf8')).local ?? [] : [];
    const pilot=resolve(SCRATCH,'../pilot/out');
    for(const file of readdirSync(pilot).filter(f=>/^(t20-|t21r-).*\.mp4$/.test(f))) {
      if(facts.local.some(r=>basename(r.file)===file)) continue;
      const times=file.includes('60s')?[2,3,10,12,20,21,28,30,39,48,58,59+29/30]:[2,10,20,28,29+29/30];
      const r=await reviewVideo(browser,resolve(pilot,file),resolve(SCRATCH,'local',file.replace('.mp4','')),times);
      facts.local.push({...r,decoded:{...r.decoded,records:undefined}});console.log('local reviewed',file);
    }
    await page.goto(url);await countActions();const started=Date.now();
    await page.getByTestId('file-input').setInputFiles(resolve('private/wahrier/waypoints-uz-2025-07-14-2025-08-26-t20.json'));
    await ready();
    facts.simplicity={waypoints:{actionsToPreview:await page.evaluate(()=>window.__acceptanceActions),previewReadySec:(Date.now()-started)/1000}};
    const before=Date.now();const result=await exportAndDownload(page);facts.simplicity.waypoints.exportSec=(Date.now()-before)/1000;
    facts.simplicity.waypoints.actionsToMp4=await page.evaluate(()=>window.__acceptanceActions);
    const out=resolve(SCRATCH,'local','simplicity-waypoints.mp4');writeFileSync(out,result.data);
    facts.simplicity.waypoints.review=await reviewVideo(browser,out,resolve(SCRATCH,'local','simplicity-waypoints'),[2,10,20,28]);
    // Отключение показателей: факт в кадре, не новый режим. Личный материал остаётся в scratchpad.
    await page.getByTestId('section-advanced').locator('summary').click();
    const toggles=page.locator('[data-testid^="info-"] input, input[data-testid^="info-"]');
    facts.montage={togglesFound:await toggles.count()};
    for(let i=0;i<await toggles.count();i++) if(await toggles.nth(i).isChecked() && await toggles.nth(i).isEnabled()) await toggles.nth(i).locator('..').click();
    facts.montage.remainingChecked=await toggles.evaluateAll(inputs=>inputs.filter(el=>el.checked).map(el=>el.dataset.testid));
    await ready();
    const snapshots=await page.evaluate(async()=>{const rs=window.__rs;const out=[];for(const t of[2,10,28]){await rs.scene.render(rs.timeline.frameAt(t),{waitForTiles:true,timeoutMs:30000});out.push({t,png:rs.scene.canvas.toDataURL('image/png')});}return out;});
    for(const s of snapshots) writeFileSync(resolve(SCRATCH,'local',`montage-t${s.t}.png`),Buffer.from(s.png.split(',')[1],'base64'));
    await page.goto(url);await countActions();const gpxStarted=Date.now();
    await page.getByTestId('file-input').setInputFiles(resolve('tracks/triglav.gpx'));await ready();
    facts.simplicity.gpx={actionsToPreview:await page.evaluate(()=>window.__acceptanceActions),previewReadySec:(Date.now()-gpxStarted)/1000};
    const gpxStart=Date.now();const gpx=await exportAndDownload(page);facts.simplicity.gpx.exportSec=(Date.now()-gpxStart)/1000;
    facts.simplicity.gpx.actionsToMp4=await page.evaluate(()=>window.__acceptanceActions);
    const gpxOut=resolve(SCRATCH,'local','simplicity-gpx-defaults.mp4');writeFileSync(gpxOut,gpx.data);
    facts.simplicity.gpx.review=await reviewVideo(browser,gpxOut,resolve(SCRATCH,'local','simplicity-gpx-defaults'),[2,10,20,28]);
    facts.styles=await page.evaluate(async()=>{const {STYLES}=await import('/src/render/styles.ts');return Object.values(STYLES).map(s=>({id:s.id,pitch:s.pitch,type:s.type,motion:s.motion,line:s.line}));});
    const coldContext=await browser.newContext({viewport:{width:1440,height:900}});await restrictNetwork(coldContext);
    const coldPage=await coldContext.newPage();const cdp=await coldContext.newCDPSession(coldPage);
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    let fontRequests=0;await coldPage.route(/manrope/i,async route=>{fontRequests++;await new Promise(r=>setTimeout(r,1800));await route.continue();});
    const fontStart=Date.now();await openAndLoadSample(coldPage,url);
    await coldPage.waitForFunction(()=>Boolean(window.__rs?.scene)&&document.querySelector('.preview__loading')?.hidden!==false,null,{timeout:90000});
    facts.fontColdSlow={cacheDisabled:true,delayMs:1800,fontRequests,readySec:(Date.now()-fontStart)/1000,fonts:await coldPage.evaluate(()=>({status:document.fonts.status,manrope:document.fonts.check('700 32px Manrope')}))};
    await coldContext.close();
  } else if (phase === 'chapters') {
    await page.goto(url);
    await page.getByTestId('file-input').setInputFiles([resolve('private/wahrier/waypoints-full-2024-11-01-2025-10-11.json'),resolve('private/wahrier/chapters.json')]);
    await ready();await page.getByTestId('duration-60').click();await ready();
    facts.cards=await page.evaluate(()=>{
      const groups=new Map();const timeline=window.__rs.timeline;
      for(let i=0;i<1800;i++){const t=i/30;const f=timeline.frameAt(t);for(const c of f.cards) if(c.chapter&&c.alpha>.8){const g=groups.get(c.chapter.id)??{from:t,to:t};g.to=t;groups.set(c.chapter.id,g);}}
      return [...groups.values()].map((g,i)=>({ordinal:i+1,...g,t:Math.round((g.from+g.to)/2*30)/30}));
    });
    const file=resolve(SCRATCH,'../pilot/out/t21r-full-ch-epic-9x16-ru-60s.mp4');
    facts.review=await reviewVideo(browser,file,resolve(SCRATCH,'chapter-cards'),facts.cards.map(c=>c.t));
    await contactSheet(browser,facts.cards.map(c=>({label:`Local chapter ${c.ordinal} t=${c.t.toFixed(3)}`,path:resolve(SCRATCH,'chapter-cards',`t${c.t.toFixed(3)}.png`)})),resolve(SCRATCH,'chapter-cards.png'),3,300,534);
    console.log('chapter cards sampled',facts.cards.length);
  } else throw new Error('phase: ui | frames | data | local | chapters');
} finally {
  facts.finished=new Date().toISOString();saveJson(resolve(SCRATCH,phase+'.json'),facts);
  await browser.close();server.kill();
}

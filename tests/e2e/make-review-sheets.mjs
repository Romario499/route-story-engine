// Компактные итоговые листы из уже извлечённых кадров; без сети и без частных материалов.
import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCRATCH, contactSheet, saveJson } from './materials.mjs';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  for(const style of ['epic','atlas']) for(const format of ['9x16','16x9']) for(const lang of ['ru','en']) {
    const key=`${style}-${format}-${lang}`;const portrait=format==='9x16';
    await contactSheet(browser,[2,10,28].map(t=>({label:`${key} t=${t} seek`,path:resolve(SCRATCH,'frames',`${key}-seek-${t}.png`)})),
      resolve('docs/visual-review/after',key+'.png'),3,portrait?240:400,portrait?426:225);
  }
  const videos=[];
  for(const folder of ['exports/redesign','exports/redesign/check']) for(const file of readdirSync(folder).filter(f=>f.endsWith('.json'))) {
    const r=JSON.parse(readFileSync(resolve(folder,file),'utf8'));
    const name=file.replace('.json','');
    const isNeon=name.startsWith('neon');
    const times=isNeon?[0,2,7,13,14+29/30]:[0,2,10,20,28,29+29/30];
    const dir=resolve(SCRATCH,'videos',isNeon?'check/'+name:name);
    const items=times.map(t=>({label:`${name} t=${t.toFixed(3)}`,path:resolve(dir,`t${t.toFixed(3)}.png`)}));
    const portrait=name.includes('9x16');
    await contactSheet(browser,items,resolve('docs/visual-review/after',name+'-mp4.png'),3,portrait?240:400,portrait?426:225);
    videos.push({...r,file:folder+'/'+name+'.mp4',sha256:r.sha256});
    if(!isNeon) {
      const key=(name.startsWith('expedition')?'epic':'atlas')+name.slice(name.indexOf('-'));
      const pairs=[];
      for(const t of[2,10,20,28]) pairs.push({label:`Preview t=${t}`,path:resolve(SCRATCH,'frames',`${key}-seek-${t}.png`)},{label:`MP4 t=${t}`,path:resolve(dir,`t${t.toFixed(3)}.png`)});
      await contactSheet(browser,pairs,resolve('docs/visual-review/preview-vs-export',key+'.png'),2,portrait?240:400,portrait?426:225);
    }
  }
  // Кадры «до» (V3) лежат только локально: каталог задаётся RS_V3_REFS, без него листы до/после не пересобираются.
  for(const format of process.env.RS_V3_REFS ? ['16x9','9x16'] : []) {
    const old=resolve(process.env.RS_V3_REFS,format==='16x9'?'07_current_export_16x9_before.png':'08_current_export_9x16_before.png');
    const name=format==='16x9'?'expedition-16x9-en':'expedition-9x16-ru';
    await contactSheet(browser,[{label:`V3 reference ${format} before`,path:old},
      {label:`Actual MP4 ${format} after t=28`,path:resolve(SCRATCH,'videos',name,'t28.000.png')}],resolve('docs/visual-review/after',`v3-before-after-${format}.png`),2,format==='16x9'?480:300,426);
  }
  saveJson(resolve('docs/visual-review/video-facts.json'),videos);
} finally {await browser.close();}

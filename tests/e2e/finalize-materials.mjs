// Дополняет отчёт только измеренными фактами. Частные изображения/геометрия сюда не копируются.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCRATCH, saveJson, sha256 } from './materials.mjs';
const load = name => JSON.parse(readFileSync(resolve(SCRATCH,name+'.json'),'utf8'));
const data=load('data'), local=load('local'), ui=load('ui'), frames=load('frames');
const videos=JSON.parse(readFileSync('docs/visual-review/video-facts.json','utf8'));
const reportPath='docs/visual-review/report.md';let report=readFileSync(reportPath,'utf8');
const n = x => x == null ? 'не записано' : x.toFixed(3);
const table = (headers,rows) => ['| '+headers.join(' | ')+' |','| '+headers.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+r.join(' | ')+' |')].join('\n');
const put=(name,text)=>{const marker='<!-- '+name+' -->';if(!report.includes(marker))throw new Error('Нет маркера '+name);report=report.replace(marker,text);};
put('video-table',table(['Файл','Размер','Кадры / fps','Секунды','Байты','Кодек','Плеер / пустые / одинаковые пары движения'],videos.map(r=>[
  `[${r.file.split('/').pop()}](../../${r.file})`,`${r.width}×${r.height}`,`${r.samples} / ${r.samples/r.durationSec}`,r.durationSec,r.sizeBytes,r.codec,
  `Edge ${r.edge}; ошибка ${r.player.error??'нет'} / ${r.decoded.blankFrames} / ${r.decoded.identicalMovementPairs} из ${r.decoded.movementPairs}`
])));
put('data-table',table(['Вход (локально)','Импорт UI, с','Превью, с','Экспорт 15 с, с','Факт'],data.routes.map(r=>[
  r.file,n(r.importUiSec),n(r.previewReadySec),n(r.exportSec),r.error?.split('\n')[0]??(r.review?`MP4 открыт; ${r.review.samples} кадров; пустых ${r.review.decoded.blankFrames}; кадры 2/7/13 с извлечены`:r.exportWarnings.join('; '))
])));
put('benchmark',table(['Набор','parse, мс','parse + build, мс','Точек на выходе'],data.benchmark.map(r=>[r.name,n(r.parsedMs),n(r.parseAndBuildMs),r.points]))+'\n\nНаблюдавшиеся экспорты 30 с: Экспедиция 16:9 EN — 75.121 с; Атлас 9:16 EN — 47.834 с; Атлас 16:9 RU — 45.701 с (зафиксированы в ходе первого успешного прогона). Для первого 9:16 и двух Неонов первоначальный отдельный замер не сохранён после повторной проверки, поэтому их время не выдумывается. Экспорты 15 с на успешной синтетике: 11.330–28.879 с; на трёх реальных GPX: 20.181–24.059 с. 363.090 с плотной синтетики — сумма двух попыток с предупреждениями, **не время успешного файла**.');
put('gaps',table(['Синтетика','Точек','По треку, км','Всего, км','Разрывов'],data.gaps.map(r=>[r.name,r.points,n(r.ownM/1000),n(r.totalM/1000),r.transfers])));
put('local',table(['Локальный материал (pilot/out/)','Размер','Кадров / секунд','Открыт / декодирован / пустых'],local.local.map(r=>[
  r.file.split(/[/\\]/).pop(),`${r.width}×${r.height}`,`${r.samples} / ${r.durationSec}`,`Edge ${r.edge} / ${r.decoded.frames} / ${r.decoded.blankFrames}`
]))+'\n\nУ полного 60-секундного T21r извлечены также 3/12/21/30/39/48/58 с — проверка каждой главы и финала локально; никаких кадров с ними в docs нет.');
put('simplicity',table(['Данные','Выбор файла → превью','Выбор файла → MP4','Дополнительно до MP4','Время экспорта / файл'],Object.entries(local.simplicity).map(([name,r])=>[
  name,`${r.actionsToPreview.length}: ${r.actionsToPreview.join(', ')}`,`${r.actionsToMp4.length}: ${r.actionsToMp4.join(', ')}`,
  r.actionsToMp4.includes('section-advanced')?'открыто':'не открыто',`${n(r.exportSec)} с / ${r.review.samples} кадров, ${r.review.durationSec} с, ${r.review.codec}`
]))+'\n\nМетки и настоящий GPX дали готовый файл с настройками по умолчанию без открытия advanced. После отдельного опыта выключения показателей: доступных переключателей '+local.montage.togglesFound+', оставшиеся включённые: '+(local.montage.remainingChecked.join(', ')||'нет')+'. Кадры 2/10/28 с только в scratchpad; интро/события/итог/атрибуция остаются.\n\nЧистый HTTP-кэш отключён через CDP; Manrope задержан на '+local.fontColdSlow.delayMs+' мс ('+local.fontColdSlow.fontRequests+' запросов). Превью готово через '+n(local.fontColdSlow.readySec)+' с, document.fonts='+local.fontColdSlow.fonts.status+'. 404 и восстановление/повтор экспорта подтверждены отдельным существующим e2e.');
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(resolve(dir,e.name)):[resolve(dir,e.name)]);
const pngs=walk('docs/visual-review').filter(f=>f.endsWith('.png'));const pngBytes=pngs.reduce((n,p)=>n+statSync(p).size,0);
if(pngBytes>25000000)throw new Error('PNG превышают 25 МБ: '+pngBytes);
const old=JSON.parse(readFileSync(resolve(SCRATCH,'old-exports-before.json'),'utf8'));
for(const[name,hash]of Object.entries(old))if(sha256(resolve('exports',name))!==hash)throw new Error('Старое видео изменено');
put('final-size','Итоговых PNG: **'+pngs.length+'**, **'+pngBytes+' байт** ('+(pngBytes/1000000).toFixed(3)+' МБ; лимит 25 МБ соблюдён, включая before). Полные исходные изображения и все частные ролики — вне репозитория. Проверка SHA-256 старых MP4: совпали оба.\n\nТяжёлые локальные материалы: `'+SCRATCH+'/`; уже снятые T20/T21r: соседний `scratchpad/pilot/out/`. Следующий шаг — владелец src исправляет UI-01 и исследует DATA-01, затем целевая повторная приёмка этих случаев; публикация остаётся отдельным решением владельца.');
report=report.replace('Очистка закономерно уменьшает число точек: входной объём не равен размеру очищенного маршрута.','Очистка может уменьшать число точек; в этих двух замерах на выходе 4676 и 200000 точек.');
writeFileSync(reportPath,report);
saveJson('docs/visual-review/measurements.json',{
  edge:ui.edge,pngBytes,pngCount:pngs.length,oldExportsUnchanged:true,
  ui:ui.matrix.map(({state,w,h,overflow,export:button})=>({state,w,h,overflow,button})),
  seek:frames.combinations.map(({key,comparisons})=>({key,comparisons})),
  data:data.routes.map(r=>({file:r.file,importUiSec:r.importUiSec,previewReadySec:r.previewReadySec,exportSec:r.exportSec,error:r.error,exportWarnings:r.exportWarnings,frames:r.review?.samples})),
  benchmark:data.benchmark,gaps:data.gaps,
  simplicity:Object.fromEntries(Object.entries(local.simplicity).map(([key,r])=>[key,{actionsToPreview:r.actionsToPreview,actionsToMp4:r.actionsToMp4,previewReadySec:r.previewReadySec,exportSec:r.exportSec,frames:r.review.samples}])),
  fontColdSlow:local.fontColdSlow,
});
console.log('report finalized;',pngBytes,'PNG bytes;',videos.length,'new MP4;',local.local.length,'local pilot MP4');

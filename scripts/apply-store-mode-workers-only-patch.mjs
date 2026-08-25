import fs from'node:fs';

function read(path){return fs.readFileSync(path,'utf8')}
function write(path,content){fs.writeFileSync(path,content)}
function replaceOnce(path,content,from,to,{skipIf}={}){
  if(content.includes(to)||skipIf?.(content))return content;
  if(!content.includes(from))throw new Error(`${path}: expected patch anchor not found`);
  return content.replace(from,to);
}

{
  const path='app/studio/page.js';
  let s=read(path);
  s=replaceOnce(path,s,"function cleanNumber(value, fallback){const n=Number(value);return Number.isFinite(n)?n:fallback}\nfunction statusLine(run){return `${run.completed_count||0}/${run.requested_count||0}${run.purged_count?` · ${run.purged_count} purged`:''}`}","function cleanNumber(value, fallback){const n=Number(value);return Number.isFinite(n)?n:fallback}\nfunction storeWorkerCount(concurrency,referenceMode,count){const max=referenceMode?4:10;return Math.min(Math.max(1,Number(count)||1),max,Math.max(1,Number(concurrency)||1))}\nfunction statusLine(run){return `${run.completed_count||0}/${run.requested_count||0}${run.purged_count?` · ${run.purged_count} purged`:''}`}",{skipIf:x=>x.includes('function storeWorkerCount(')});
  s=replaceOnce(path,s,"const grouped=await runPool(selected,Math.min(2,concurrency),async(p,pi)=>{","const workerCount=storeWorkerCount(concurrency,externalReferencesEnabled,selected.length);\n      setProgress({done:0,total,status:`Starting ${workerCount} concurrent product${workerCount===1?'':'s'} across ${selected.length} SKU${selected.length===1?'':'s'}…`});\n      const grouped=await runPool(selected,workerCount,async(p,pi)=>{");
  s=s.replaceAll('<label className="workers">Parallel AI<select','<label className="workers">Concurrent products<select');
  write(path,s);
}

{
  const path='app/page.js';
  let s=read(path);
  s=replaceOnce(path,s,"const BATCH_RETRY_CAP=8,REPAIR_CALL_CAP=4,STYLE_REPAIR_CALL_CAP=2,DETERMINISTIC_REPAIR_CALL_CAP=1;","const BATCH_RETRY_CAP=8,REPAIR_CALL_CAP=4,STYLE_REPAIR_CALL_CAP=2,DETERMINISTIC_REPAIR_CALL_CAP=1;\nconst SINGLE_PRODUCT_WORKERS=1;",{skipIf:x=>x.includes('SINGLE_PRODUCT_WORKERS=1')});
  s=replaceOnce(path,s,"const groups=chunks(plan.items,10),parts=Array(groups.length),failedBatches=[];let cursor=0,completed=0,settled=0,generated=[];setProgress({done:0,total,status:`Blueprint ready · starting ${Math.min(concurrency,groups.length)} coordinated AI workers…`});","const groups=chunks(plan.items,10),parts=Array(groups.length),failedBatches=[],workerCount=Math.min(SINGLE_PRODUCT_WORKERS,groups.length);let cursor=0,completed=0,settled=0,generated=[];setProgress({done:0,total,status:'Blueprint ready · generating single-product batches sequentially…'});");
  s=s.replace("await Promise.all(Array.from({length:Math.min(concurrency,groups.length)},worker));return{parts:parts.filter(Boolean),failedBatches}}","await Promise.all(Array.from({length:workerCount},worker));return{parts:parts.filter(Boolean),failedBatches}}");
  s=s.replace("runPool(groups,Math.min(concurrency,groups.length),async(items,index)=>","runPool(groups,Math.min(SINGLE_PRODUCT_WORKERS,groups.length),async(items,index)=>");
  s=s.replaceAll('<label className="workers">Parallel AI<select','<label className="workers">Concurrent products<select');
  write(path,s);
}

{
  const path='app/globals.css';
  let s=read(path);
  const rule='\nform .grid label:nth-child(3){display:none}\n';
  if(!s.includes('form .grid label:nth-child(3){display:none}'))s+=rule;
  write(path,s);
}

console.log('Applied store-mode-only worker patch.');

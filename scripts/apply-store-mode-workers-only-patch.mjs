import fs from'node:fs';

function read(path){return fs.readFileSync(path,'utf8')}
function write(path,content){fs.writeFileSync(path,content)}
function replaceOnce(path,content,from,to,{skipIf}={}){
  if(content.includes(to)||skipIf?.(content))return content;
  if(!content.includes(from))throw new Error(`${path}: expected patch anchor not found`);
  return content.replace(from,to);
}
function replaceRegex(path,content,pattern,to,{skipIf}={}){
  if(skipIf?.(content))return content;
  if(!pattern.test(content))throw new Error(`${path}: expected regex patch anchor not found`);
  return content.replace(pattern,to);
}

{
  const path='app/studio/page.js';
  let s=read(path);
  const cleanNumber="function cleanNumber(value, fallback){const n=Number(value);return Number.isFinite(n)?n:fallback}\n";
  const helperBlock=cleanNumber+
    "function cleanReviewCount(value, fallback=100){const n=Math.round(Number(value));return Number.isFinite(n)?Math.max(5,Math.min(250,n)):fallback}\n"+
    "function reviewCountValue(product,fallback=100){return product?.reviewCount??cleanReviewCount(fallback,100)}\n"+
    "function validReviewCount(value){const n=Number(value);return Number.isInteger(n)&&n>=5&&n<=250}\n"+
    "function storeWorkerCount(concurrency,referenceMode,count){const max=referenceMode?4:10;return Math.min(Math.max(1,Number(count)||1),max,Math.max(1,Number(concurrency)||1))}\n";
  if(!s.includes('function cleanReviewCount(')){
    const oldWorkerBlock=cleanNumber+"function storeWorkerCount(concurrency,referenceMode,count){const max=referenceMode?4:10;return Math.min(Math.max(1,Number(count)||1),max,Math.max(1,Number(concurrency)||1))}\n";
    s=s.includes(oldWorkerBlock)?s.replace(oldWorkerBlock,helperBlock):replaceOnce(path,s,cleanNumber,helperBlock);
  }
  s=replaceOnce(path,s,"const rows=j.products.map(p=>({...p,enabled:true,status:'queued'}));setProducts(rows);setMeta({...j,scanned:0,failed:0});","const defaultReviewCount=cleanReviewCount(f.reviewCount,100),rows=j.products.map(p=>({...p,enabled:true,status:'queued',reviewCount:defaultReviewCount}));setProducts(rows);setMeta({...j,scanned:0,failed:0});");
  s=replaceOnce(path,s,"function useProduct(p){if(p.status!=='done')return;setF(x=>({...x,productUrl:p.url,productTitle:p.productTitle,productDescription:p.productDescription}));form.current?.scrollIntoView({behavior:'smooth'})}","function useProduct(p){if(p.status!=='done')return;setF(x=>({...x,productUrl:p.url,productTitle:p.productTitle,productDescription:p.productDescription,reviewCount:reviewCountValue(p,x.reviewCount)}));form.current?.scrollIntoView({behavior:'smooth'})}\n  function setProductReviewCount(index,value){setProducts(a=>a.map(x=>x.index===index?{...x,reviewCount:value}:x))}",{skipIf:x=>x.includes('function setProductReviewCount(')});
  const generateStore=[
    "  async function generateStore(){",
    "    const selected=products.filter(x=>x.enabled&&x.status==='done');if(!selected.length){setErr('Select at least one successfully scanned product.');return}",
    "    const target=+f.targetAverage,defaultCount=cleanReviewCount(f.reviewCount,100);",
    "    const selectedWithCounts=selected.map(p=>({...p,requestedReviewCount:Number(p.reviewCount??defaultCount)}));",
    "    const invalid=selectedWithCounts.find(p=>!validReviewCount(p.requestedReviewCount));if(invalid){setErr(`Review count for ${invalid.productTitle||invalid.title||'one product'} must be 5–250.`);return}",
    "    setGenBusy(true);setErr('');setResult(null);setBulkResult(null);setActiveRun(null);",
    "    const total=selectedWithCounts.reduce((n,p)=>n+p.requestedReviewCount,0);",
    "    try{",
    "      await ensureSupabase();",
    "      let finished=0;",
    "      const workerCount=storeWorkerCount(concurrency,externalReferencesEnabled,selectedWithCounts.length);",
    "      setProgress({done:0,total,status:`Starting ${workerCount} concurrent product${workerCount===1?'':'s'} across ${selectedWithCounts.length} SKU${selectedWithCounts.length===1?'':'s'} / ${total.toLocaleString()} reviews…`});",
    "      const grouped=await runPool(selectedWithCounts,workerCount,async(p,pi)=>{",
    "        const perSku=p.requestedReviewCount;",
    "        const input={productUrl:p.url,productTitle:p.productTitle,productDescription:p.productDescription,reviewCount:perSku,targetAverage:target,externalReferencesEnabled};",
    "        const run=await createServerRun(input);",
    "        const final=await processServerRun(run.id,`${pi+1}/${selectedWithCounts.length} · ${p.productTitle}`,perSku,{base:finished,grandTotal:total});",
    "        finished+=final.reviews?.length||0;",
    "        return{...final,productUrl:p.url,productTitle:p.productTitle,existingReviewCount:p.extracted?.existingReviewCount??null,requestedReviewCount:perSku,reviewCount:final.reviews?.length||0,targetAverage:target};",
    "      });",
    "      const totalReviews=grouped.reduce((n,p)=>n+(p.reviews?.length||0),0),totalPurgedReviews=grouped.reduce((n,p)=>n+(p.purgedReviewCount||0),0);",
    "      setBulkResult({runId:`SUPABASE-CATALOG-${Date.now().toString(36)}`,products:grouped,skuCount:grouped.length,generatedReviewCount:total,totalReviews,totalPurgedReviews,targetAverage:target,reviewCountPerSku:null,customReviewCounts:true,reviewCountsBySku:grouped.map(p=>({productTitle:p.productTitle,productUrl:p.productUrl,requestedReviewCount:p.requestedReviewCount})),synthetic:true,fixtureType:'synthetic_review_qa',publicationAllowed:false,datasetPurpose:'internal_qa_modeling'});",
    "      setProgress({done:totalReviews,total,status:totalPurgedReviews?`Complete · ${totalPurgedReviews} purged`:'Complete'});",
    "    }catch(e){setErr(e.message||'Bulk generation failed.')}",
    "    finally{setGenBusy(false)}",
    "  }"
  ].join('\n');
  s=replaceRegex(path,s,/  async function generateStore\(\)\{[\s\S]*?\n  \}\n\n  const shown=/,generateStore+"\n\n  const shown=");
  s=replaceOnce(path,s,"const shown=useMemo(()=>{const q=filter.trim().toLowerCase();return q?products.filter(x=>(`${x.productTitle||x.title} ${x.handle} ${x.url}`).toLowerCase().includes(q)):products},[products,filter]);\n  const enabled=products.filter(x=>x.enabled).length,allOn=products.length>0&&enabled===products.length,callEstimate=generationCallEstimate(f.reviewCount),generationSkuCount=mode==='store'?products.filter(x=>x.enabled&&x.status==='done').length:1;","const shown=useMemo(()=>{const q=filter.trim().toLowerCase();return q?products.filter(x=>(`${x.productTitle||x.title} ${x.handle} ${x.url}`).toLowerCase().includes(q)):products},[products,filter]);\n  const selectedStoreProducts=products.filter(x=>x.enabled&&x.status==='done'),storeRequestedTotal=selectedStoreProducts.reduce((n,p)=>{const count=Number(p.reviewCount??cleanReviewCount(f.reviewCount,100));return n+(validReviewCount(count)?count:0)},0);\n  const enabled=products.filter(x=>x.enabled).length,allOn=products.length>0&&enabled===products.length,callEstimate=generationCallEstimate(f.reviewCount),generationSkuCount=mode==='store'?selectedStoreProducts.length:1;",{skipIf:x=>x.includes('selectedStoreProducts=products.filter')});
  s=s.replaceAll('<label className="workers">Parallel AI<select','<label className="workers">Concurrent products<select');
  s=s.replace(">{genBusy?'Generating…':`Generate ${products.filter(x=>x.enabled&&x.status==='done').length} SKUs →`}</button>",">{genBusy?'Generating…':`Generate ${selectedStoreProducts.length} SKUs / ${storeRequestedTotal.toLocaleString()} reviews →`}</button>");
  s=replaceOnce(path,s,"<div className={`reviewCount ${p.status==='done'&&p.extracted?.existingReviewCount!=null?'known':''}`}><span>Live reviews · reference only</span><strong>{p.status==='done'?(p.extracted?.existingReviewCount==null?'Unavailable':p.extracted.existingReviewCount.toLocaleString()):p.status==='scanning'?'Checking…':'—'}</strong></div>","<div className={`reviewCount ${p.status==='done'&&p.extracted?.existingReviewCount!=null?'known':''}`}><span>Generate reviews</span><input type=\"number\" min=\"5\" max=\"250\" value={reviewCountValue(p,f.reviewCount)} onChange={e=>setProductReviewCount(p.index,e.target.value)} disabled={busy||genBusy}/><small>Live: {p.status==='done'?(p.extracted?.existingReviewCount==null?'Unavailable':p.extracted.existingReviewCount.toLocaleString()):p.status==='scanning'?'Checking…':'—'}</small></div>");
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
  s=s.replace('.item{display:grid;grid-template-columns:42px 10px minmax(0,1fr) 120px auto;','.item{display:grid;grid-template-columns:42px 10px minmax(0,1fr) 150px auto;');
  const rules=[
    '\nform .grid label:nth-child(3){display:none}\n',
    '.reviewCount input{width:92px;text-align:right;padding:8px 9px}\n',
    '.reviewCount small{color:#788593;font-size:10px;text-transform:none}\n'
  ];
  for(const rule of rules)if(!s.includes(rule.trim()))s+=rule;
  write(path,s);
}

console.log('Applied store-mode worker/count patch.');

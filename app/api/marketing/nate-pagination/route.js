import{createHash,timingSafeEqual}from'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';const SEED='nate_425865145ed94ddb1861b037500e29cf';
const TARGET='https://site.twstalker.com/service/api',PROFILE='https://site.twstalker.com/Nate_Google_',ZONE='synthetic_review_ebay_items';
const hash=x=>createHash('sha256').update(x).digest('hex');const H={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function GET(req){
 const p=new URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!token||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_API_KEY||'';
 async function store(op,b={}){const r=await fetch(STORE,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({op,...b}),cache:'no-store',signal:AbortSignal.timeout(45000)}),t=await r.text();if(!r.ok)throw Error('Storage '+r.status+': '+t.slice(0,500));return t?JSON.parse(t):null}
 async function upstream(path,body){const r=await fetch('https://api.brightdata.com'+path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(90000)});const text=await r.text();let value;try{value=JSON.parse(text)}catch{value=text}return{status:r.status,value}}
 const safe=e=>String(e.message||e).split(key).join('[REDACTED]').slice(0,1400);
 async function step(){
  const jobs=(await store('list')).filter(j=>j.request?.mode==='mirror_cursor');
  const pending=jobs.find(j=>j.status==='mirror_running');
  if(pending){
   const result=await upstream('/unblocker/get_result?response_id='+encodeURIComponent(pending.diagnostics.response_id));
   if(result.status===202)return{id:pending.id,status:'running',page:pending.request.page};
   let body=result.value?.body??result.value;if(typeof body==='string'){try{body=JSON.parse(body)}catch{}}
   const http=result.value?.status_code??result.status;
   const entries=body&&typeof body==='object'&&body.tweets?Object.entries(body.tweets):[];
   const tweets=entries.map(([id,t])=>({...t,id_str:/^\d{8,24}$/.test(id)?id:t.id_str}));
   const cursor=typeof body?.cursor==='string'?body.cursor:null;
   const ids=tweets.map(x=>String(x.id_str||x.id||'')).filter(x=>/^\d{8,24}$/.test(x));
   const authored=tweets.filter(x=>String(x.core?.screen_name||'').toLowerCase()==='nate_google_');
   const dates=authored.map(x=>x.created_at).filter(Boolean).map(x=>Date.parse(x)).filter(Number.isFinite).sort((a,b)=>a-b);
   const ok=http===200&&body&&typeof body==='object'&&('tweets'in body);
   const diagnostics={...pending.diagnostics,page:pending.request.page,http,postCount:tweets.length,authored:authored.length,postIds:ids,cursor,hasMore:Boolean(cursor&&cursor!==pending.request.cursor&&tweets.length),oldest:dates.length?new Date(dates[0]).toISOString():null,newest:dates.length?new Date(dates.at(-1)).toISOString():null,fields:[...new Set(tweets.flatMap(x=>Object.keys(x||{})))],responsePreview:ok?null:JSON.stringify(body).slice(0,2000)};
   await store('patch',{id:pending.id,patch:{status:ok?'complete':'failed',record_count:1,raw_records:[{response:body,transport:'bright_data_web_unlocker',url:TARGET}],diagnostics,...(ok?{}:{error:{message:'Invalid pagination response',http}})}});
   return{id:pending.id,status:ok?'complete':'failed',page:pending.request.page,postCount:tweets.length,authored:authored.length,oldest:diagnostics.oldest,newest:diagnostics.newest,hasMore:diagnostics.hasMore,...(ok?{}:{responsePreview:diagnostics.responsePreview})};
  }
  const complete=jobs.filter(j=>j.status==='complete').sort((a,b)=>b.request.page-a.request.page);
  if(jobs.some(j=>['reserved','trigger_unknown'].includes(j.status)))return{error:'Ambiguous page requires reconciliation; no duplicate request.',status:'blocked'};
  let cursor,page=2;
  if(complete.length){const last=complete[0];cursor=last.diagnostics.cursor;page=last.request.page+1;if(!last.diagnostics.hasMore)return{status:'timeline_exhausted',page:last.request.page,completeHistoryVerified:false}}
  else{
   const seed=await store('get',{id:SEED});const html=seed?.raw_records?.[0]?.html||'';
   const tag=html.match(/<a\b[^>]*class=["'][^"']*add-nw-event[^"']*["'][^>]*>/i)?.[0]||'';
   cursor=tag.match(/data-cursor=["']([^"']+)["']/i)?.[1];page=Number(tag.match(/data-ec=["'](\d+)["']/i)?.[1]||2);
   if(tag.match(/data-query=["']([^"']+)["']/i)?.[1]!=='1544391592106201091')throw Error('Unexpected profile target');
  }
  if(!cursor||page>400)throw Error('Missing cursor or page budget reached');
  const config={mode:'mirror_cursor',url:TARGET,page,cursor,profile_id:'1544391592106201091'};
  const id='nate_'+hash(JSON.stringify(config)).slice(0,32);const reserved=await store('reserve',{id,request:config,max:1});
  if(!reserved.created)return{...reserved.job,diagnostics:undefined,request:undefined};
  try{
   const form=new URLSearchParams({page:String(page),cursor,data:'1544391592106201091',action:'profile'}).toString();
   const body={url:TARGET,method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8',Referer:PROFILE,Origin:'https://site.twstalker.com','X-Requested-With':'XMLHttpRequest'},body:form};
   const result=await upstream('/unblocker/req?zone='+ZONE,body);await store('patch',{id,patch:{diagnostics:{triggerResponse:result}}});
   if(result.status!==200||!result.value?.response_id)throw Error('Pagination submit failed: '+JSON.stringify(result).slice(0,1200));
   await store('patch',{id,patch:{status:'mirror_running',diagnostics:{response_id:result.value.response_id,page}}});return{id,page,status:'running'};
  }catch(e){await store('patch',{id,patch:{status:'trigger_unknown',error:{message:safe(e)}}});throw e}
 }
 try{
  if(p.get('op')==='advance')return Response.json(await step(),{headers:H});
  if(p.get('op')==='run'){
   const until=Date.now()+210000,results=[];let pages=0;
   while(Date.now()<until&&pages<8){const s=await step();if(s.status==='complete'){results.push(s);pages++}else if(s.status!=='running'){results.push(s);break}await sleep(s.status==='complete'?200:5000)}
   return Response.json({results,completedPages:pages},{headers:H});
  }
  const jobs=(await store('list')).filter(j=>j.request?.mode==='mirror_cursor');
  return Response.json({pages:jobs.map(j=>({id:j.id,status:j.status,page:j.request.page,postCount:j.diagnostics.postCount,authored:j.diagnostics.authored,oldest:j.diagnostics.oldest,newest:j.diagnostics.newest,hasMore:j.diagnostics.hasMore,error:j.error}))},{headers:H});
 }catch(e){return Response.json({error:safe(e)},{status:502,headers:H})}
}

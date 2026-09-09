import {createHash,timingSafeEqual} from 'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';
const PROFILE='https://x.com/Nate_Google_';const DATASET='gd_lwxkxvnf1cynvib9co';
const key=()=>process.env.BRIGHT_DATA_DATASET_API_KEY||process.env.BRIGHT_DATA_SCRAPER_API_KEY||process.env.BRIGHT_DATA_API_KEY;
const digest=x=>createHash('sha256').update(x).digest('hex');
const json=x=>Response.json(x,{headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'}});
async function call(url,headers,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(60000)});const t=await r.text();if(!r.ok){const e=new Error('Upstream '+r.status+': '+t.slice(0,400));e.status=r.status;throw e}return t?JSON.parse(t):null}
export async function GET(req){
 const p=new URL(req.url).searchParams;const token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(Date.now()>Date.parse('2026-09-10T00:00:00Z')||!token||!timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const store=(op,body={})=>call(STORE,{authorization:'Bearer '+token,'content-type':'application/json'},{op,...body});
 const bright=(path,body)=>call('https://api.brightdata.com'+path,{authorization:'Bearer '+key(),'content-type':'application/json'},body);
 const safe=e=>String(e.message).split(key()).join('[REDACTED]');
 const mode=p.get('mode')==='profiles_array'?'profiles_array':'profile_url';
 async function run(input,limit=100,direct=false){
  if(mode==='profiles_array'&&!direct)input=input.map(({url,...rest})=>({urls:[url],...rest}));
  const config={mode:direct?'direct':mode,input,limit};const id='nate_'+digest(JSON.stringify(config)).slice(0,32);
  const reserved=await store('reserve',{id,request:config,max:limit});if(!reserved.created)return reserved.job;
  try{
   const params=new URLSearchParams({dataset_id:DATASET,limit_per_input:String(limit),limit_multiple_results:String(limit),include_errors:'true'});
   if(!direct){params.set('type','discover_new');params.set('discover_by',mode)}
   const result=await bright('/datasets/v3/trigger?'+params,input);
   if(!/^sd_[\w-]+$/.test(result?.snapshot_id||''))throw Error('Missing snapshot; do not retry');
   await store('patch',{id,patch:{snapshot_id:result.snapshot_id,status:'running'}});return{id,...result,request:config};
  }catch(e){await store('patch',{id,patch:{status:e.status?'failed':'trigger_unknown',...(e.status?{record_count:0}:{}),error:{message:safe(e)}}});return{id,error:safe(e)}}
 }
 try{
  const op=p.get('op');
  if(op==='start'){
   const results=[];for(const [start_date,end_date]of[['2026-09-01','2026-09-09'],['2025-10-01','2025-11-01'],['2023-06-01','2023-07-01']])results.push(await run([{url:PROFILE,start_date,end_date}]));return json(results);
  }
  if(op==='full')return json(await run([{url:PROFILE,start_date:'2022-07-01',end_date:'2026-09-09'}],5500));
  if(op==='month'){
   const month=p.get('month');if(!/^202[2-6]-(0[1-9]|1[0-2])$/.test(month||'')||month<'2022-07'||month>'2026-09')throw Error('Invalid month');
   const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);
   const end_date=month==='2026-09'?'2026-09-09':d.toISOString().slice(0,10);
   return json(await run([{url:PROFILE,start_date:month+'-01',end_date}],500));
  }
  if(op==='window'){
   const start_date=p.get('start'),end_date=p.get('end'),limit=Number(p.get('limit')||100);
   if(!/^202[2-6]-\d\d-\d\d$/.test(start_date||'')||!/^202[2-6]-\d\d-\d\d$/.test(end_date||'')||start_date<'2022-07-01'||end_date>'2026-09-10'||end_date<=start_date||!Number.isInteger(limit)||limit<1||limit>6000)throw Error('Invalid bounded window');
   return json(await run([{url:PROFILE,start_date,end_date}],limit));
  }
  if(op==='direct'){
   const id=p.get('post');if(!/^\d{16,24}$/.test(id||''))throw Error('Invalid Nate post ID');
   return json(await run([{url:PROFILE+'/status/'+id}],5,true));
  }
  if(op==='poll'){
   const results=[];for(const j of (await store('list')).filter(x=>x.status==='running').slice(0,8)){
    const progress=await bright('/datasets/v3/progress/'+j.snapshot_id);
    if(progress.status==='ready'){
     const rows=await bright('/datasets/v3/snapshot/'+j.snapshot_id+'?format=json');if(!Array.isArray(rows))throw Error('Snapshot is not an array');
     const a=rows;const dates=a.map(x=>x.date_posted).filter(Boolean).sort();const authored=a.filter(x=>String(x.user_posted||'').toLowerCase()==='nate_google_');
     const start=j.request.input[0]?.start_date,end=j.request.input[0]?.end_date;
     const diagnostics={records:a.length,authored:authored.length,oldest:dates[0],newest:dates.at(-1),outsideWindow:authored.filter(x=>x.date_posted&&((start&&x.date_posted<start)||(end&&x.date_posted>=end))).length,atLimit:a.length>=j.max_records,errors:a.filter(x=>!x.id).slice(0,3)};
     await store('patch',{id:j.id,patch:{status:'complete',raw_records:a,record_count:a.length,diagnostics}});results.push({id:j.id,...diagnostics});
    }else if(progress.status==='failed'){await store('patch',{id:j.id,patch:{status:'failed',record_count:0,error:progress}});results.push({id:j.id,...progress})}
    else results.push({id:j.id,...progress});
   }return json(results);
  }
  if(op==='data')return json(p.get('id')?await store('get',{id:p.get('id')}):await store('legacy'));
  if(op==='details')return json(await bright('/datasets/v3/datasets/'+DATASET));
  return json({version:4,configured:Boolean(key()),jobs:await store('list')});
 }catch(e){return json({error:safe(e)})}
}

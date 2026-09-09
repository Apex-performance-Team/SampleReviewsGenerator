import {createHash,timingSafeEqual} from 'node:crypto';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';
const PROFILE='https://x.com/Nate_Google_';
const DATASET='gd_lwxkxvnf1cynvib9co';
const key=()=>process.env.BRIGHT_DATA_DATASET_API_KEY||process.env.BRIGHT_DATA_SCRAPER_API_KEY||process.env.BRIGHT_DATA_API_KEY;
const digest=x=>createHash('sha256').update(x).digest('hex');
const json=x=>Response.json(x,{headers:{'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'}});
async function call(url,headers,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(60000)});const t=await r.text();if(!r.ok)throw Error('Upstream '+r.status+': '+t.slice(0,400));return t?JSON.parse(t):null}
export async function GET(req){
 const p=new URL(req.url).searchParams;const token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(Date.now()>Date.parse('2026-09-10T00:00:00Z')||!token||!timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const store=(op,body={})=>call(STORE,{authorization:'Bearer '+token,'content-type':'application/json'},{op,...body});
 const bright=(path,body)=>call('https://api.brightdata.com'+path,{authorization:'Bearer '+key(),'content-type':'application/json'},body);
 try{
  if(p.get('op')==='start'){
   const results=[];
   for(const [start_date,end_date]of[['2026-09-01','2026-09-09'],['2025-10-01','2025-11-01'],['2023-06-01','2023-07-01']]){
    const input=[{url:PROFILE,start_date,end_date}];const config={mode:'recent',input,limit:100};const id='nate_'+digest(JSON.stringify(config)).slice(0,32);
    const reserved=await store('reserve',{id,request:config,max:100});
    if(!reserved.created){results.push(reserved.job);continue}
    try{
     const params=new URLSearchParams({dataset_id:DATASET,type:'discover_new',discover_by:'profile_url_most_recent_posts',limit_per_input:'100',limit_multiple_results:'100',include_errors:'true'});
     const result=await bright('/datasets/v3/trigger?'+params,input);
     if(!/^sd_[\w-]+$/.test(result?.snapshot_id||''))throw Error('Missing snapshot; do not retry');
     await store('patch',{id,patch:{snapshot_id:result.snapshot_id,status:'running'}});results.push({id,...result});
    }catch(e){await store('patch',{id,patch:{status:'trigger_unknown',error:{message:String(e.message).split(key()).join('[REDACTED]')}}});throw e}
   }return json(results);
  }
  if(p.get('op')==='poll'){
   const results=[];for(const j of (await store('list')).filter(x=>x.status==='running')){
    const progress=await bright('/datasets/v3/progress/'+j.snapshot_id);
    if(progress.status==='ready'){
     const rows=await bright('/datasets/v3/snapshot/'+j.snapshot_id+'?format=json');
     const a=Array.isArray(rows)?rows:[];const dates=a.map(x=>x.date_posted).filter(Boolean).sort();
     const diagnostics={records:a.length,oldest:dates[0],newest:dates.at(-1),errors:a.filter(x=>!x.id).slice(0,3)};
     await store('patch',{id:j.id,patch:{status:'complete',raw_records:a,record_count:a.length,diagnostics}});results.push({id:j.id,...diagnostics});
    }else results.push({id:j.id,...progress});
   }return json(results);
  }
  return json({configured:Boolean(key()),jobs:await store('list')});
 }catch(e){return json({error:String(e.message).split(key()).join('[REDACTED]')})}
}

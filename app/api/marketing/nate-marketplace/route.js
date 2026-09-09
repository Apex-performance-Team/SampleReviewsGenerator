import{createHash,timingSafeEqual}from'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';
const DATASET='gd_lwxkxvnf1cynvib9co';
const digest=s=>createHash('sha256').update(s).digest('hex');
const headers={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'};
export async function GET(req){
 const p=new URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!token||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_DATASET_API_KEY||process.env.BRIGHT_DATA_SCRAPER_API_KEY||process.env.BRIGHT_DATA_API_KEY;
 async function call(url,auth,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(60000)}),t=await r.text();if(!r.ok){const e=new Error('HTTP '+r.status+': '+t.slice(0,800));e.status=r.status;throw e}try{return t?JSON.parse(t):null}catch{return{invalidJSON:true,preview:t.slice(0,500)}}}
 const store=(op,body={})=>call(STORE,token,{op,...body});
 const safe=e=>String(e.message).split(key).join('[REDACTED]');
 const input={dataset_id:DATASET,records_limit:500,filter:{name:'user_posted',operator:'in',value:['Nate_Google_','nate_google_']}};
 const config={mode:'marketplace_filter',input,limit:500};const id='nate_'+digest(JSON.stringify(config)).slice(0,32);
 try{
  if(p.get('op')==='start'){
   const reserve=await store('reserve',{id,request:config,max:500});if(!reserve.created)return Response.json(reserve.job,{headers});
   try{
    const data=await call('https://api.brightdata.com/datasets/filter',key,input);
    if(!/^s[dn]?_[\w-]+$/.test(data?.snapshot_id||''))throw Error('Missing snapshot; reconcile manually without retry');
    await store('patch',{id,patch:{status:'market_running',snapshot_id:data.snapshot_id}});return Response.json({id,...data,request:config},{headers});
   }catch(e){await store('patch',{id,patch:{status:e.status?'failed':'trigger_unknown',...(e.status?{record_count:0}:{}),error:{message:safe(e)}}});throw e}
  }
  const job=await store('get',{id});
  if(p.get('op')!=='poll'||!job?.snapshot_id||job.status==='complete'||job.status==='failed')return Response.json(job,{headers});
  const meta=await call('https://api.brightdata.com/datasets/snapshots/'+job.snapshot_id,key);
  if(meta.status==='ready'){
   const data=await call('https://api.brightdata.com/datasets/snapshots/'+job.snapshot_id+'/download?format=json',key);
   if(!Array.isArray(data))throw Error('Unexpected snapshot shape');
   const dates=data.map(x=>x.date_posted).filter(Boolean).sort();
   const diagnostics={records:data.length,oldest:dates[0],newest:dates.at(-1),metadata:meta,completeHistoryVerified:false};
   await store('patch',{id,patch:{status:'complete',record_count:data.length,raw_records:data,diagnostics}});return Response.json({id,...diagnostics},{headers});
  }
  if(meta.status==='failed')await store('patch',{id,patch:{status:'failed',record_count:0,error:meta}});
  return Response.json({id,metadata:meta},{headers});
 }catch(e){return Response.json({error:safe(e)},{status:502,headers})}
}

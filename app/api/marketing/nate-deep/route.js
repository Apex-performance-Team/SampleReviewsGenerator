import{createHash,timingSafeEqual}from'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';const DATASET='gd_lwxkxvnf1cynvib9co';
const digest=s=>createHash('sha256').update(s).digest('hex');const headers={'cache-control':'private, no-store','referrer-policy':'no-referrer'};
export async function GET(req){
 const p=new URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!token||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_DATASET_API_KEY||process.env.BRIGHT_DATA_SCRAPER_API_KEY||process.env.BRIGHT_DATA_API_KEY;
 async function call(url,auth,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(60000)}),t=await r.text();if(!r.ok){const e=new Error('HTTP '+r.status+': '+t.slice(0,600));e.status=r.status;throw e}return t?JSON.parse(t):null}
 const store=(op,body={})=>call(STORE,token,{op,...body});
 try{
  const op=p.get('op');if(!['start','continue'].includes(op))return Response.json({jobs:await store('list')},{headers});
  let excluded=[];let limit=6000;
  if(op==='continue'){
   limit=500;const ids=new Set((await store('legacy')).map(x=>String(x.raw?.id||'')));
   for(const j of(await store('list')).filter(x=>x.status==='complete')){
    const full=await store('get',{id:j.id});for(const r of full.raw_records||[])if(r.id)ids.add(String(r.id));
   }
   excluded=[...ids].filter(x=>/^\d+$/.test(x)).sort();
  }
  const input=[{url:'https://x.com/Nate_Google_',num_of_posts:limit,posts_to_not_include:excluded,start_date:'2022-07-01',end_date:'2026-09-09',include_reposts:true}];
  const config={mode:'profile_url_num_posts',input,limit};const id='nate_'+digest(JSON.stringify(config)).slice(0,32);
  const reserve=await store('reserve',{id,request:config,max:limit});if(!reserve.created)return Response.json(reserve.job,{headers});
  try{
   const params=new URLSearchParams({dataset_id:DATASET,type:'discover_new',discover_by:'profile_url',limit_per_input:String(limit),limit_multiple_results:String(limit),include_errors:'true'});
   const data=await call('https://api.brightdata.com/datasets/v3/trigger?'+params,key,input);
   await store('patch',{id,patch:{diagnostics:{triggerResponse:data}}});
   if(!/^sd_[\w-]+$/.test(data?.snapshot_id||''))throw Error('Missing snapshot; reconcile manually without retry');
   await store('patch',{id,patch:{status:'running',snapshot_id:data.snapshot_id}});
   return Response.json({id,...data,excludedIds:excluded.length,limit},{headers});
  }catch(e){await store('patch',{id,patch:{status:e.status?'failed':'trigger_unknown',...(e.status?{record_count:0}:{}),error:{message:String(e.message).split(key).join('[REDACTED]')}}});throw e}
 }catch(e){return Response.json({error:String(e.message).split(key).join('[REDACTED]')},{status:502,headers})}
}

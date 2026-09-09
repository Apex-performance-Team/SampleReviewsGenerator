import{createHash,timingSafeEqual}from'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';
const DATASET='gd_lwxmeb2u1cniijd7t4';const H={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'};
const hash=s=>createHash('sha256').update(s).digest('hex');
export async function GET(req){
 const p=new URL(req.url).searchParams,t=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!t||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(Buffer.from(hash(t),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_DATASET_API_KEY||process.env.BRIGHT_DATA_SCRAPER_API_KEY||process.env.BRIGHT_DATA_API_KEY;
 async function call(url,token,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(60000)}),s=await r.text();if(!r.ok)throw Error('HTTP '+r.status+': '+s.slice(0,600));return s?JSON.parse(s):null}
 const store=(op,b={})=>call(STORE,t,{op,...b});
 const input=[{url:'https://x.com/Nate_Google_',max_number_of_posts:6000}];const config={mode:'native_profile_record',input,limit:1};const id='nate_'+hash(JSON.stringify(config)).slice(0,32);
 try{
  if(p.get('op')==='start'){
   const r=await store('reserve',{id,request:config,max:1});if(!r.created)return Response.json(r.job,{headers:H});
   try{const v=await call('https://api.brightdata.com/datasets/v3/trigger?dataset_id='+DATASET+'&include_errors=true&limit_multiple_results=1',key,input);await store('patch',{id,patch:{diagnostics:{trigger_response:v}}});if(!/^sd_[\w-]+$/.test(v?.snapshot_id||''))throw Error('Missing snapshot ID; do not retry');await store('patch',{id,patch:{status:'native_profile_running',snapshot_id:v.snapshot_id}});return Response.json({id,...v},{headers:H})}catch(e){await store('patch',{id,patch:{status:'trigger_unknown',error:{message:String(e.message).split(key).join('[REDACTED]')}}});throw e}
  }
  const j=await store('get',{id});if(!j?.snapshot_id||j.status==='complete')return Response.json(j?{id,status:j.status,diagnostics:j.diagnostics}:null,{headers:H});
  const progress=await call('https://api.brightdata.com/datasets/v3/progress/'+j.snapshot_id,key);
  if(progress.status!=='ready')return Response.json(progress,{headers:H});
  const raw=await call('https://api.brightdata.com/datasets/v3/snapshot/'+j.snapshot_id+'?format=json',key);
  const profiles=Array.isArray(raw)?raw:[];const posts=profiles.flatMap(x=>(x.posts||[]).map(y=>({...y,id:y.post_id,url:y.post_url,user_posted:x.id})));
  const diagnostics={profile_records:profiles.length,post_records:posts.length,profile_fields:profiles[0]?Object.keys(profiles[0]):[],profile_count:profiles[0]?.posts_count,joined:profiles[0]?.date_joined,errors:profiles.filter(x=>x.error)};
  await store('patch',{id,patch:{status:'complete',record_count:1,raw_records:posts,diagnostics:{...diagnostics,profile_metadata:profiles.map(x=>({...x,posts:undefined}))}}});return Response.json({id,...diagnostics},{headers:H});
 }catch(e){return Response.json({error:String(e.message).split(key).join('[REDACTED]')},{status:502,headers:H})}
}

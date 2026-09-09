import{createHash,timingSafeEqual}from'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const IDS=['gd_lwxkxvnf1cynvib9co','gd_lhqdbl2k1adkkc5tss','gd_lhx2xjme1tayrrs1xo','gd_lwxmeb2u1cniijd7t4'];
const PENDING=['sd_mttglmsf16ml8icida','sd_mttevdse1yu1azkv9g'];
export async function GET(req){
 const p=new URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!token||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_DATASET_API_KEY||process.env.BRIGHT_DATA_SCRAPER_API_KEY||process.env.BRIGHT_DATA_API_KEY;
 const fetchJSON=async path=>{const r=await fetch('https://api.brightdata.com'+path,{headers:{authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(60000)});const t=await r.text();let value;try{value=JSON.parse(t)}catch{value=t.slice(0,2000)}return{status:r.status,value}};
 try{
  const op=p.get('op')||'catalog';let result;
  if(op==='catalog'){result=await fetchJSON('/datasets/list');if(Array.isArray(result.value))result.value=result.value.filter(x=>/twitter|\bx\b|article/i.test(x.name||''))}
  else if(op==='metadata'){
   const id=p.get('id')||IDS[0];if(!IDS.includes(id))return new Response('Invalid dataset',{status:400});result=await fetchJSON('/datasets/'+id+'/metadata');
  }else if(op==='schemas'){
   result=await fetchJSON('/datasets/v3/scrapers');if(Array.isArray(result.value))result.value=result.value.filter(x=>IDS.includes(x.id)).map(x=>({...x,scrapers:Object.fromEntries(Object.entries(x.scrapers||{}).map(([k,v])=>[k,{input_schema:v.input_schema,sample_input:v.sample_input,link:v.link}]))}));
  }else if(op==='snapshots')result=await fetchJSON('/datasets/v3/snapshots?dataset_id='+IDS[0]+'&limit=20');
  else if(op==='pending'){
   result=await Promise.all(PENDING.map(async id=>{const progress=await fetchJSON('/datasets/v3/progress/'+id);if(progress.value?.status!=='ready')return{id,progress};const r=await fetchJSON('/datasets/v3/snapshot/'+id+'?format=json');const rows=Array.isArray(r.value)?r.value:[];return{id,progress,http:r.status,records:rows.length,fields:rows[0]?Object.keys(rows[0]):[],posts:rows.reduce((n,x)=>n+(Array.isArray(x.posts)?x.posts.length:0),0),profile:rows[0]?{id:rows[0].id,posts_count:rows[0].posts_count,date_joined:rows[0].date_joined}:null,sample:rows.slice(0,1).map(x=>({...x,posts:Array.isArray(x.posts)?x.posts.slice(0,2):x.posts})),errors:rows.filter(x=>x.error).slice(0,3)}}));
  }else if(op==='snapshot'){
   const id=p.get('id');if(!PENDING.includes(id))return new Response('Invalid snapshot',{status:400});result=await fetchJSON('/datasets/v3/snapshot/'+id+'?format=json');
  }else if(op==='page7'){
   result=await fetchJSON('/unblocker/get_result?response_id=s2w8t1788920343514r5n9cmpj4iuc');
  }else if(op==='log'){
   const id=p.get('snapshot');const allowed=[...PENDING,'sd_mtte3c2y1m59k361qv','sd_mttevd6010mxzfuxay','sd_mtteven81ix5oxneu7','sd_mtteso4435r0lb7o1','sd_mttf6qd41iuatono7w'];
   if(!allowed.includes(id))return new Response('Invalid snapshot',{status:400});result=await fetchJSON('/datasets/v3/log/'+id);
  }else if(op==='zones'){result=await fetchJSON('/zone/get_active_zones');if(Array.isArray(result.value))result.value=result.value.map(({name,type})=>({name,type}))}
  else return new Response('Invalid operation',{status:400});
  return Response.json(result,{headers:{'cache-control':'private, no-store','x-robots-tag':'noindex','referrer-policy':'no-referrer'}});
 }catch(e){return Response.json({error:String(e.message).split(key).join('[REDACTED]')},{status:502})}
}

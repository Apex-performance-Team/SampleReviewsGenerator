import{createHash,timingSafeEqual}from'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=120;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const DATASET='gd_lwxkxvnf1cynvib9co';
export async function GET(req){
 const p=new URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!token||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_DATASET_API_KEY||process.env.BRIGHT_DATA_SCRAPER_API_KEY||process.env.BRIGHT_DATA_API_KEY;
 const fetchJSON=async path=>{const r=await fetch('https://api.brightdata.com'+path,{headers:{authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(30000)});const t=await r.text();let value;try{value=JSON.parse(t)}catch{value=t.slice(0,1000)}return{status:r.status,value}};
 try{
  const op=p.get('op')||'catalog';let result;
  if(op==='catalog'){result=await fetchJSON('/datasets/list');if(Array.isArray(result.value))result.value=result.value.filter(x=>/twitter|\bx\b|article/i.test(x.name||''))}
  else if(op==='metadata')result=await fetchJSON('/datasets/'+DATASET+'/metadata');
  else if(op==='log'){
   const id=p.get('snapshot');const allowed=['sd_mtte3c2y1m59k361qv','sd_mttevd6010mxzfuxay','sd_mttevdse1yu1azkv9g','sd_mtteven81ix5oxneu7','sd_mtteso4435r0lb7o1'];
   if(!allowed.includes(id))return new Response('Invalid snapshot',{status:400});result=await fetchJSON('/datasets/v3/log/'+id);
  }else if(op==='zones'){result=await fetchJSON('/zone/get_active_zones');if(Array.isArray(result.value))result.value=result.value.map(({name,type})=>({name,type}))}
  else return new Response('Invalid operation',{status:400});
  return Response.json(result,{headers:{'cache-control':'private, no-store','x-robots-tag':'noindex','referrer-policy':'no-referrer'}});
 }catch(e){return Response.json({error:String(e.message).split(key).join('[REDACTED]')},{status:502})}
}

import { createHash, timingSafeEqual } from 'node:crypto';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=300;
const HASH='eeb803ca9122d1d9568f48ba0f36938c2907894d25f455d2a10edb7985b95e4f';
const EXPIRES=Date.parse('2026-09-12T12:00:00Z');
const DATASET='gd_lwxkxvnf1cynvib9co';
const H={'cache-control':'private, no-store','x-robots-tag':'noindex'};
const hash=x=>createHash('sha256').update(String(x)).digest('hex');
export async function GET(req){
 const q=new URL(req.url).searchParams;
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||q.get('ticket')||'';
 const postUrl=q.get('url')||'';
 const ok=token&&Date.now()<EXPIRES&&timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(HASH,'hex'));
 if(!ok||!/^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(postUrl))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_API_KEY||'';
 try{
  const r=await fetch(`https://api.brightdata.com/datasets/v3/scrape?dataset_id=${DATASET}&format=json`,{
   method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},
   body:JSON.stringify({input:[{url:postUrl}]}),cache:'no-store',signal:AbortSignal.timeout(180000)
  });
  const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}
  if(!r.ok)return Response.json({status:r.status,error:typeof data==='string'?data.slice(0,1000):data},{status:502,headers:H});
  const row=Array.isArray(data)?data[0]:data;
  return Response.json({status:r.status,keys:row&&typeof row==='object'?Object.keys(row):[],row},{headers:H});
 }catch(e){return Response.json({error:String(e?.message||e).split(key).join('[REDACTED]').slice(0,1000)},{status:502,headers:H})}
}

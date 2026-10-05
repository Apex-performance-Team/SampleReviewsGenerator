import { createHash, timingSafeEqual } from 'node:crypto';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const TOKEN_HASH='bf9e0e740b498eb6230f789c6f13e81f2003258c44a21bd1062af0f8565d0cf7';
const EXPIRES=Date.parse('2026-10-06T03:00:00Z');
const QUERY='damascus kitchen knives';
const SEARCH='https://www.aliexpress.com/w/wholesale-damascus-kitchen-knives.html';
function allowed(req){
 if(Date.now()>EXPIRES)return false;
 const token=(req.headers.get('authorization')||'').replace(/^Bearer /,'');
 const hash=createHash('sha256').update(token).digest();
 return timingSafeEqual(hash,Buffer.from(TOKEN_HASH,'hex'));
}
async function bd(path,body){
 const key=process.env.BRIGHT_DATA_API_KEY;
 if(!key)throw Error('Bright Data key missing in preview environment');
 const r=await fetch('https://api.brightdata.com'+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(45000)});
 const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw.slice(0,2000)}
 return {status:r.status,data};
}
export async function GET(req){
 if(!allowed(req))return Response.json({error:'Unauthorized or expired'},{status:401});
 try{
 const q=new URL(req.url).searchParams,mode=q.get('mode')||'catalog';
 if(mode==='catalog'){const r=await bd('/datasets/list');const rows=Array.isArray(r.data)?r.data:r.data?.datasets||r.data?.data||[];return Response.json({status:r.status,datasets:rows.filter(x=>/aliexpress/i.test(JSON.stringify(x))),query:QUERY});}
 if(mode==='schema'){const id=q.get('dataset');if(!/^gd_[a-z0-9]+$/.test(id||''))throw Error('Invalid dataset');return Response.json(await bd('/datasets/'+id+'/metadata'));}
 const id=q.get('snapshot');if(!/^sd?_[a-zA-Z0-9]+$/.test(id||''))throw Error('Invalid snapshot');
 if(mode==='progress')return Response.json(await bd('/datasets/v3/progress/'+id));
 if(mode==='snapshot')return Response.json(await bd('/datasets/v3/snapshot/'+id+'?format=json'));
 throw Error('Invalid mode');
 }catch(e){return Response.json({error:e.message},{status:502});}
}
export async function POST(req){
 if(!allowed(req))return Response.json({error:'Unauthorized or expired'},{status:401});
 try{
 const b=await req.json();if(b.mode!=='trigger')throw Error('Invalid mode');
 const catalog=await bd('/datasets/list');const rows=Array.isArray(catalog.data)?catalog.data:catalog.data?.datasets||catalog.data?.data||[];
 const id=b.dataset;if(!rows.some(x=>(x.id===id||x.dataset_id===id)&&/aliexpress/i.test(JSON.stringify(x))))throw Error('Dataset must be an AliExpress scraper');
 const qs=new URLSearchParams({dataset_id:id,format:'json',include_errors:'true',limit_per_input:'10'});
 if(b.discover_by){if(!['keyword','category_url','url'].includes(b.discover_by))throw Error('Invalid discovery type');qs.set('type','discover_new');qs.set('discover_by',b.discover_by);}
 const input=b.discover_by==='keyword'?[{keyword:QUERY,country:'US',all_variations:false}]:[{url:SEARCH,all_variations:false}];
 return Response.json(await bd('/datasets/v3/trigger?'+qs,input));
 }catch(e){return Response.json({error:e.message},{status:502});}
}

import{createHash,timingSafeEqual}from'node:crypto';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=180;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';
const URL='https://site.twstalker.com/Nate_Google_';
const digest=x=>createHash('sha256').update(x).digest('hex');
const H={'cache-control':'private, no-store','x-robots-tag':'noindex','referrer-policy':'no-referrer'};
export async function GET(req){
 const p=new globalThis.URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!token||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(Buffer.from(digest(token),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_API_KEY||'';
 async function store(op,b={}){const r=await fetch(STORE,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({op,...b}),cache:'no-store',signal:AbortSignal.timeout(30000)});const t=await r.text();if(!r.ok)throw Error(t.slice(0,500));return t?JSON.parse(t):null}
 const config={mode:'public_profile_html',url:URL,limit:1};const id='nate_'+digest(JSON.stringify(config)).slice(0,32);
 try{
  let job=await store('get',{id});
  if(p.get('op')==='fetch'&&!job){
   const reserved=await store('reserve',{id,request:config,max:1});if(!reserved.created)return Response.json(reserved.job,{headers:H});
   let html='',transport='direct',directStatus=null;
   try{const r=await fetch(URL,{headers:{accept:'text/html','user-agent':'Mozilla/5.0'},cache:'no-store',signal:AbortSignal.timeout(20000)});directStatus=r.status;html=await r.text();if(!r.ok||!html.includes('Nate_Google_'))throw Error('direct_incomplete')}
   catch{
    transport='bright_data_web_unlocker';const r=await fetch('https://api.brightdata.com/request',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({zone:'synthetic_review_ebay_items',url:URL,format:'raw'}),cache:'no-store',signal:AbortSignal.timeout(90000)});html=await r.text();if(!r.ok)throw Error('Unlocker HTTP '+r.status+': '+html.slice(0,700));
    try{const v=JSON.parse(html);html=typeof v==='string'?v:v.body||v.html||html}catch{}
   }
   const scripts=[...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map(m=>m[1]);
   const inline=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]).filter(x=>/cursor|loadmore|load_more|tweets|Nate_Google_/i.test(x));
   const markers=[...html.matchAll(/.{0,160}(?:cursor|loadmore|load-more|load_more|loadMore|data-max|data-user|data-id|pagination).{0,250}/gi)].map(m=>m[0]);
   const postIds=[...new Set([...html.matchAll(/Nate_Google_\/status\/(\d+)/gi)].map(m=>m[1]))];
   const diagnostics={transport,directStatus,htmlBytes:html.length,postIds,scripts,inlineScripts:inline.map(x=>x.slice(0,14000)),pagination:markers.slice(0,40),title:html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||null};
   await store('patch',{id,patch:{status:'complete',record_count:1,raw_records:[{url:URL,html,transport}],diagnostics}});job={id,diagnostics};
  }
  return Response.json(job?{id:job.id,status:job.status,diagnostics:job.diagnostics}:null,{headers:H});
 }catch(e){const error=String(e.message).split(key).join('[REDACTED]');await store('patch',{id,patch:{status:'failed',record_count:0,error:{message:error}}}).catch(()=>{});return Response.json({error},{status:502,headers:H})}
}

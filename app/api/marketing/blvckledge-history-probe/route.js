import {createHash,timingSafeEqual} from 'node:crypto';
import {WebSocket} from 'undici';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
const HASH='8940a885ae6e50aca994e11f0fe4d53dbcf4508326238f344a4a37be740b1979',EXPIRES=Date.parse('2026-09-10T12:00:00Z');
const H={'cache-control':'private, no-store','x-robots-tag':'noindex','referrer-policy':'no-referrer'};
export async function GET(req){
 const q=new URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')||q.get('ticket')||'';
 if(!token||Date.now()>EXPIRES||!timingSafeEqual(createHash('sha256').update(token).digest(),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404,headers:H});
 const key=process.env.BRIGHT_DATA_API_KEY||'',search='from:blvckledge since:2025-03-03 until:2025-04-17',url='https://site.twstalker.com/search/'+encodeURIComponent(search);let password='',ws;const pending=new Map();let seq=0;
 async function api(path){const r=await fetch('https://api.brightdata.com'+path,{headers:{authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Bright Data HTTP '+r.status);return r.json()}
 try{
 const account=await api('/status'),creds=await api('/zone/passwords?zone=nate_archive_browser');password=creds.passwords?.[0]||'';if(!account.customer||!password)throw Error('No browser credentials');
 ws=new WebSocket('wss://brd.superproxy.io:9222',{headers:{Authorization:'Basic '+Buffer.from('brd-customer-'+account.customer+'-zone-nate_archive_browser:'+password).toString('base64')}});
 ws.addEventListener('message',async e=>{let m;try{m=JSON.parse(typeof e.data==='string'?e.data:await e.data.text())}catch{return}if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(Error('connect_timeout')),25000);ws.addEventListener('open',()=>{clearTimeout(t);resolve()},{once:true});ws.addEventListener('error',()=>{clearTimeout(t);reject(Error('connect_failed'))},{once:true})});
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('timeout:'+method))},method==='Page.navigate'?120000:55000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
 const target=await send('Target.createTarget',{url:'about:blank'}),attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true}),cmd=(method,p={})=>send(method,p,attached.sessionId);
 await cmd('Page.enable');await cmd('Runtime.enable');const nav=await cmd('Page.navigate',{url});
 let state;for(let i=0;i<50;i++){const ev=await cmd('Runtime.evaluate',{expression:'({ready:document.readyState,title:document.title,length:document.body?.innerText?.length||0})',returnByValue:true});state=ev.result?.value;if(state&&state.ready!=='loading'&&state.length>1000)break;await new Promise(r=>setTimeout(r,600))}
 const expression=`(()=>{const scripts=[...document.scripts].filter(s=>s.textContent.includes('/service/api')).map(s=>s.textContent);const apiFragments=scripts.flatMap(s=>[...s.matchAll(/\\/service\\/api/g)].map(m=>s.slice(Math.max(0,m.index-800),m.index+1800)));const controls=[...document.querySelectorAll('[data-cursor],[data-query],[role=tab]')].map(e=>e.outerHTML.slice(0,2000));const links=[...document.querySelectorAll('a[href*="/status/"]')];return{title:document.title,url:location.href,text:document.body?.innerText?.slice(0,18000),controls,postLinks:[...new Set(links.map(a=>a.href))],exampleCards:links.slice(0,3).map(a=>a.parentElement?.parentElement?.outerHTML?.slice(0,14000)),apiFragments,scriptSources:[...document.scripts].map(s=>s.src).filter(Boolean)}})()`;
 const ev=await cmd('Runtime.evaluate',{expression,returnByValue:true});return Response.json({search,nav,state,page:ev.result?.value,error:ev.exceptionDetails?.text||null},{headers:H});
 }catch(e){let s=String(e?.message||e);for(const x of[key,password,token])if(x)s=s.split(x).join('[REDACTED]');return Response.json({error:s.slice(0,1200)},{status:502,headers:H})}finally{for(const p of pending.values())clearTimeout(p.timer);pending.clear();try{ws?.close()}catch{}}
}

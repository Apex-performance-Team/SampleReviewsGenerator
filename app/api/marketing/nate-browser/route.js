import{createHash,timingSafeEqual}from'node:crypto';
import{WebSocket}from'undici';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=300;
const HASH='d68e38384fa494c2acf37f5a3512a197aff0117b99fa6595cf8948a61c80b7aa';
const STORE='https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-archive-store';
const ZONE='nate_archive_browser',TARGET='https://site.twstalker.com/service/api',PROFILE='https://site.twstalker.com/Nate_Google_';
const hash=x=>createHash('sha256').update(x).digest('hex');const H={'cache-control':'private, no-store','referrer-policy':'no-referrer','x-robots-tag':'noindex'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
export async function GET(req){
 const began=Date.now(),p=new URL(req.url).searchParams,token=req.headers.get('authorization')?.replace(/^Bearer /i,'')||p.get('ticket')||'';
 if(!token||Date.now()>Date.parse('2026-09-10T00:00:00Z')||!timingSafeEqual(Buffer.from(hash(token),'hex'),Buffer.from(HASH,'hex')))return new Response('Not found',{status:404});
 const key=process.env.BRIGHT_DATA_API_KEY||'';let password='',ws=null,bytes=0,verification=null;
 const safe=e=>{let s=String(e?.message||e);for(const x of[key,password])if(x)s=s.split(x).join('[REDACTED]');return s.slice(0,1400)};
 async function http(url,auth,body){const r=await fetch(url,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(45000)}),t=await r.text();if(!r.ok)throw Error('Upstream HTTP '+r.status+': '+t.slice(0,600));return t?JSON.parse(t):null}
 const bd=(path,body)=>http('https://api.brightdata.com'+path,key,body),store=(op,b={})=>http(STORE,token,{op,...b});
 try{
  const op=p.get('op')||'status';const jobs=(await store('list')).filter(j=>j.request?.mode==='mirror_cursor');
  if(op==='status')return Response.json({version:2,pages:jobs.map(j=>({page:j.request.page,status:j.status,posts:j.diagnostics.postCount,oldest:j.diagnostics.oldest}))},{headers:H});
  if(op!=='run')throw Error('Unsupported operation');
  if(jobs.some(j=>['mirror_running','browser_running','reserved','trigger_unknown'].includes(j.status)))return Response.json({status:'existing_page_pending',message:'Finish the existing page before another browser run.'},{headers:H});
  const zones=await bd('/zone/get_active_zones');if(!zones.some(z=>z.name===ZONE&&z.type==='browser_api'))throw Error('Browser zone not configured');
  const latest=jobs.filter(j=>j.status==='complete').sort((a,b)=>b.request.page-a.request.page)[0];
  if(!latest?.diagnostics?.hasMore)return Response.json({status:'no_verified_cursor',completeHistoryVerified:false},{headers:H});
  let page=latest.request.page+1,cursor=latest.diagnostics.cursor;
  const account=await bd('/status');const credentials=await bd('/zone/passwords?zone='+ZONE);password=credentials.passwords?.[0]||'';
  if(!account.customer||!password)throw Error('Browser credentials unavailable');
  const username='brd-customer-'+account.customer+'-zone-'+ZONE;
  ws=new WebSocket('wss://brd.superproxy.io:9222',{headers:{Authorization:'Basic '+Buffer.from(username+':'+password).toString('base64')}});
  const pending=new Map();let seq=0;
  ws.addEventListener('message',async event=>{let m;try{m=JSON.parse(typeof event.data==='string'?event.data:await event.data.text())}catch{return}if(m.method==='Network.loadingFinished')bytes+=Number(m.params?.encodedDataLength||0);if(m.id&&pending.has(m.id)){const t=pending.get(m.id);pending.delete(m.id);clearTimeout(t.timer);m.error?t.reject(Error(m.error.message)):t.resolve(m.result)}});
  ws.addEventListener('close',()=>{for(const t of pending.values()){clearTimeout(t.timer);t.reject(Error('Browser connection closed'))}pending.clear()});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser connection timed out')),45000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve()},{once:true});ws.addEventListener('error',e=>{clearTimeout(timer);reject(Error(e.message||'Browser connection failed'))},{once:true})});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timeout: '+method))},method==='Captcha.solve'?125000:65000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))});
  const target=await send('Target.createTarget',{url:'about:blank'});const attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});const session=attached.sessionId;
  const cmd=(method,params)=>send(method,params,session);
  await cmd('Page.enable');await cmd('Runtime.enable');await cmd('Network.enable');
  await cmd('Captcha.setAutoSolve',{autoSolve:true});
  await cmd('Unblocker.enableAdBlock',{version:'2',mode:'full'});
  await cmd('Page.navigate',{url:PROFILE});
  verification=await cmd('Captcha.solve',{detectTimeout:30000});
  if(['solve_failed','invalid'].includes(verification?.status))throw Error('Provider verification failed: '+JSON.stringify(verification));
  let ready=false;for(let n=0;n<20&&Date.now()-began<200000;n++){const r=await cmd('Runtime.evaluate',{expression:'Boolean(document.querySelector(".add-nw-event[data-query=\\"1544391592106201091\\"]"))',returnByValue:true});if(r.result?.value){ready=true;break}await sleep(2000)}
  if(!ready){const r=await cmd('Runtime.evaluate',{expression:'({title:document.title,body:document.body?.innerText?.slice(0,700)})',returnByValue:true});throw Error('Public profile not ready: '+JSON.stringify(r.result?.value))}
  const results=[],end=began+240000;
  while(page<=400&&results.length<60&&Date.now()<end&&bytes<25000000){
   const config={mode:'mirror_cursor',url:TARGET,page,cursor,profile_id:'1544391592106201091'};const id='nate_'+hash(JSON.stringify(config)).slice(0,32);
   const reserved=await store('reserve',{id,request:config,max:1});if(!reserved.created){results.push({id,status:'existing_page'});break}
   await store('patch',{id,patch:{status:'browser_running',diagnostics:{page,transport:'bright_data_browser_api'}}});
   try{
    const form=new URLSearchParams({page:String(page),cursor,data:'1544391592106201091',action:'profile'}).toString();
    const expression='(async()=>{const r=await fetch("/service/api",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/x-www-form-urlencoded; charset=UTF-8","X-Requested-With":"XMLHttpRequest"},body:'+JSON.stringify(form)+'});return {status:r.status,text:await r.text()}})()';
    const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Pagination browser exception');const result=r.result?.value;
    let body;try{body=JSON.parse(result.text)}catch{throw Error('Pagination response was not JSON: '+String(result?.text).slice(0,300))}
    if(result.status!==200||!body||typeof body!=='object'||!('tweets'in body))throw Error('Invalid pagination response: '+JSON.stringify(body).slice(0,500));
    const entries=Object.entries(body.tweets||{}),tweets=entries.map(([id,t])=>({...t,id_str:id}));
    const authored=tweets.filter(t=>String(t.core?.screen_name||'').toLowerCase()==='nate_google_');const dates=authored.map(t=>Date.parse(t.created_at)).filter(Number.isFinite).sort((a,b)=>a-b);
    const next=typeof body.cursor==='string'?body.cursor:null,hasMore=Boolean(next&&next!==cursor&&entries.length);
    const diagnostics={page,transport:'bright_data_browser_api',postCount:entries.length,authored:authored.length,postIds:entries.map(([id])=>id),cursor:next,hasMore,oldest:dates.length?new Date(dates[0]).toISOString():null,newest:dates.length?new Date(dates.at(-1)).toISOString():null,sessionBytes:bytes};
    await store('patch',{id,patch:{status:'complete',record_count:1,raw_records:[{response:body,transport:'bright_data_browser_api',url:TARGET}],diagnostics}});
    results.push({id,page,posts:entries.length,authored:authored.length,oldest:diagnostics.oldest,hasMore});if(!hasMore)break;cursor=next;page++;await sleep(400);
   }catch(e){await store('patch',{id,patch:{status:'failed',record_count:1,error:{message:safe(e)}}});throw e}
  }
  return Response.json({results,verification,sessionBytes:bytes,completeHistoryVerified:false},{headers:H});
 }catch(e){return Response.json({error:safe(e),verification,sessionBytes:bytes},{status:502,headers:H})}finally{if(ws)try{ws.close()}catch{}}
}

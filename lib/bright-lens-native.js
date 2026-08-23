import{AsyncLocalStorage}from'node:async_hooks';
import{ProxyAgent,fetch as proxyFetch,FormData}from'undici';

const API='https://api.brightdata.com';
const LENS_API='https://api.brightdata.com/request';
const AI_GATEWAY='https://ai-gateway.vercel.sh/v1/responses';
const OPENAI_API='https://api.openai.com/v1/responses';
const NATIVE_PROXY='http://brd.superproxy.io:44445';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';
const baseFetch=globalThis.fetch.bind(globalThis);
const contextStore=new AsyncLocalStorage();
const credentialCache=new Map();
const uploadCache=new Map();
let installed=false;

function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function headerValue(headers,name){try{return new Headers(headers||{}).get(name)||''}catch{return''}}
function bearer(headers){const h=headerValue(headers,'authorization');return h.replace(/^Bearer\s+/i,'').trim()}
function safeJson(raw){try{let j=JSON.parse(raw);if(typeof j==='string')j=JSON.parse(j);return j}catch{return null}}
function imageTarget(target){try{const u=new URL(target);if(u.hostname!=='lens.google.com'||u.pathname!=='/uploadbyurl')return null;const image=u.searchParams.get('url');if(!image)return null;return{image,tab:u.searchParams.get('brd_lens')||'visual_matches'}}catch{return null}}
function cacheSet(map,key,value,max=30){map.set(key,value);while(map.size>max)map.delete(map.keys().next().value);return value}
function shape(j){return{keys:j&&typeof j==='object'?Object.keys(j).slice(0,16):[],generalType:clean(j?.general?.type||''),images:Array.isArray(j?.images)?j.images.length:null,exactMatches:Array.isArray(j?.exact_matches)?j.exact_matches.length:null,products:Array.isArray(j?.products)?j.products.length:null,visualMatches:Array.isArray(j?.visual_matches)?j.visual_matches.length:null,tabs:Array.isArray(j?.tabs)?j.tabs.map(x=>x?.type||x?.name||'').filter(Boolean).slice(0,12):[]}}
function safeImageLabel(x){try{const u=new URL(x);return`${u.hostname}${u.pathname}`.slice(0,220)}catch{return clean(x).slice(0,220)}}
function lensResultCount(j,tab){if(tab==='exact_matches')return Array.isArray(j?.exact_matches)?j.exact_matches.length:0;if(tab==='products')return(Array.isArray(j?.products)?j.products.length:0)+(clean(j?.general?.type)==='products'&&Array.isArray(j?.images)?j.images.length:0);if(tab==='visual_matches')return(Array.isArray(j?.visual_matches)?j.visual_matches.length:0)+((['visual_matches','all'].includes(clean(j?.general?.type)))&&Array.isArray(j?.images)?j.images.length:0);return 0}

async function apiJson(path,key){const r=await baseFetch(`${API}${path}`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(15000)}),raw=await r.text();if(!r.ok)throw Error(`Bright Data account API ${r.status}: ${clean(raw).slice(0,200)}`);const j=safeJson(raw);if(j==null)throw Error('Bright Data account API returned invalid JSON.');return j}

async function nativeCredentials(key,zone){
  const ck=`${key.slice(0,8)}:${zone}`,cached=credentialCache.get(ck);if(cached&&Date.now()-cached.at<10*60*1000)return cached.value;
  const promise=(async()=>{
    const[status,zoneInfo]=await Promise.all([apiJson('/status',key),apiJson(`/zone?zone=${encodeURIComponent(zone)}`,key)]);
    const customer=clean(status?.customer);let password='';
    if(Array.isArray(zoneInfo?.password))password=clean(zoneInfo.password[0]);else if(typeof zoneInfo?.password==='string')password=clean(zoneInfo.password);
    if(!password){const p=await apiJson(`/zone/passwords?zone=${encodeURIComponent(zone)}`,key).catch(()=>null);if(Array.isArray(p))password=clean(p[0]);else if(Array.isArray(p?.password))password=clean(p.password[0]);else if(typeof p?.password==='string')password=clean(p.password)}
    if(!customer)throw Error('Bright Data customer ID could not be resolved from the API key.');
    if(!password)throw Error(`Bright Data SERP zone "${zone}" has no native-access password available.`);
    const user=`brd-customer-${customer}-zone-${zone}`,auth=Buffer.from(`${user}:${password}`).toString('base64');
    return{customer,user,agent:new ProxyAgent({uri:NATIVE_PROXY,auth,requestTls:{rejectUnauthorized:false}})};
  })();
  cacheSet(credentialCache,ck,{at:Date.now(),value:promise},10);return promise;
}

async function downloadImage(imageUrl,referer){
  const tryFetch=async ref=>{const r=await baseFetch(imageUrl,{headers:{'user-agent':UA,'accept':'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.2',...(ref?{referer:ref}:{})},redirect:'follow',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`source_image_http_${r.status}`);const ct=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(),bytes=Buffer.from(await r.arrayBuffer());if(!ct.startsWith('image/')||ct==='image/svg+xml')throw Error(`source_image_not_raster:${ct||'unknown'}`);if(bytes.length<300||bytes.length>7*1024*1024)throw Error(`source_image_size_${bytes.length}`);return{bytes,contentType:ct}}
  try{return await tryFetch(referer)}catch(first){if(referer){try{return await tryFetch('')}catch{}}throw first}
}

async function uploadImage(imageUrl,key,zone,referer){
  const ck=`${zone}|${imageUrl}`,cached=uploadCache.get(ck);if(cached&&Date.now()-cached.at<5*60*1000)return cached.value;
  const promise=(async()=>{
    const[{agent},image]=await Promise.all([nativeCredentials(key,zone),downloadImage(imageUrl,referer)]),session=`srl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
    const fd=new FormData(),ext=image.contentType.includes('png')?'png':image.contentType.includes('webp')?'webp':'jpg';fd.append('encoded_image',new Blob([image.bytes],{type:image.contentType}),`product.${ext}`);
    const r=await proxyFetch('https://lens.google.com/v3/upload',{method:'POST',headers:{'x-brd-session':session,'x-unblock-data-format':'parsed_light'},body:fd,dispatcher:agent,signal:AbortSignal.timeout(70000)}),raw=await r.text();if(!r.ok)throw Error(`bright_data_native_upload_${r.status}:${clean(raw).slice(0,220)}`);const json=safeJson(raw);if(!json||typeof json!=='object')throw Error(`Bright Data native Lens upload returned non-JSON data: ${clean(raw).slice(0,180)}`);return{json,agent,session};
  })();
  cacheSet(uploadCache,ck,{at:Date.now(),value:promise},24);return promise;
}

function hasTabPayload(j,tab){if(tab==='exact_matches')return Array.isArray(j?.exact_matches);if(tab==='products')return Array.isArray(j?.products)||(clean(j?.general?.type)==='products'&&Array.isArray(j?.images));if(tab==='visual_matches')return Array.isArray(j?.visual_matches)||(['visual_matches','all'].includes(clean(j?.general?.type))&&Array.isArray(j?.images));return false}
function canonicalTabLink(link){const u=new URL(link),values=u.searchParams.getAll('vsrid'),vsrid=values[0]||'';u.searchParams.delete('vsrid');if(vsrid)u.searchParams.append('vsrid',vsrid);u.searchParams.set('brd_json','1');return u}

async function tabResult(upload,tab){
  if(tab==='visual_matches'&&Array.isArray(upload.json.images)&&upload.json.images.length)return{...upload.json,visual_matches:upload.json.images};
  if(tab==='exact_matches'&&Array.isArray(upload.json.exact_matches))return upload.json;
  if(tab==='products'&&Array.isArray(upload.json.products))return upload.json;
  if(tab==='visual_matches'&&Array.isArray(upload.json.visual_matches))return upload.json;
  const entry=(upload.json.tabs||[]).find(x=>x?.type===tab&&x?.link);
  if(entry?.link){
    const u=canonicalTabLink(entry.link),headers={'x-brd-session':upload.session,'x-unblock-data-format':'parsed_light'};
    const r=await proxyFetch(u.href,{headers,dispatcher:upload.agent,signal:AbortSignal.timeout(60000)}),raw=await r.text();
    if(!r.ok)throw Error(`bright_data_native_${tab}_${r.status}:${clean(raw).slice(0,220)}`);
    const j=safeJson(raw);if(!j||typeof j!=='object')throw Error(`bright_data_native_${tab}_invalid_json:${clean(raw).slice(0,180)}`);
    if(!hasTabPayload(j,tab))throw Error(`bright_data_native_${tab}_missing_payload:type=${clean(j?.general?.type||'unknown')};keys=${Object.keys(j).slice(0,12).join('|')}`);
    if(tab==='visual_matches'&&Array.isArray(j.images)&&!Array.isArray(j.visual_matches))return{...j,visual_matches:j.images};
    if(tab==='products'&&clean(j?.general?.type)==='products'&&Array.isArray(j.images)&&!Array.isArray(j.products))return{...j,products:j.images};
    return j;
  }
  if(tab==='visual_matches'&&Array.isArray(upload.json.images))return{...upload.json,visual_matches:upload.json.images};
  if(tab==='products')return{...upload.json,products:[]};
  return tab==='exact_matches'?{...upload.json,exact_matches:[]}:{...upload.json,[tab]:[]};
}

function responseFor(json){return new Response(JSON.stringify(json),{status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-srl-lens-transport':'native-file-upload'}})}
async function originalLensResponse(input,init,ctx,lens,reason){
  const r=await baseFetch(input,init),raw=await r.text(),json=safeJson(raw);
  if(Array.isArray(ctx?.diagnostics))ctx.diagnostics.push({image:safeImageLabel(lens.image),tab:lens.tab,fallback:'url_uploadbyurl',fallbackReason:reason,status:r.status,result:shape(json)});
  return new Response(raw,{status:r.status,statusText:r.statusText,headers:{'content-type':r.headers.get('content-type')||'application/json','cache-control':'no-store','x-srl-lens-transport':'url-uploadbyurl-fallback'}})
}
async function aiGatewayWithDirectFallback(input,init){
  const first=await baseFetch(input,init),directKey=process.env.OPENAI_API_KEY||'';
  if(first.ok||!directKey)return first;
  if(![401,402,403,429,500,502,503,504].includes(first.status))return first;
  let body;try{body=JSON.parse(String(init?.body||''))}catch{return first}
  let direct;try{direct=await baseFetch(OPENAI_API,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${directKey}`},body:JSON.stringify({...body,model:process.env.OPENAI_DIRECT_MODEL||'gpt-5.6'}),signal:init?.signal||AbortSignal.timeout(70000)})}catch{return first}
  if(direct.ok)return direct;
  const[gatewayRaw,directRaw]=await Promise.all([first.clone().text().catch(()=>''),direct.clone().text().catch(()=>'')]);
  return new Response(JSON.stringify({error:{message:`AI Gateway failed (${first.status}): ${clean(gatewayRaw).slice(0,220)} | Direct OpenAI failed (${direct.status}): ${clean(directRaw).slice(0,220)}`}}),{status:502,headers:{'content-type':'application/json','cache-control':'no-store'}})
}

export function installBrightLensNativeTransport(){
  if(installed)return;installed=true;
  globalThis.fetch=async function(input,init={}){
    const requestUrl=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    if(requestUrl===AI_GATEWAY)return aiGatewayWithDirectFallback(input,init);
    if(requestUrl===LENS_API&&typeof init?.body==='string'){
      let body;try{body=JSON.parse(init.body)}catch{body=null}const lens=imageTarget(body?.url);
      if(lens){const key=bearer(init.headers),zone=clean(body?.zone),ctx=contextStore.getStore()||{};if(!key||!zone)return baseFetch(input,init);try{const upload=await uploadImage(lens.image,key,zone,ctx.referer||''),result=await tabResult(upload,lens.tab),nativeCount=lensResultCount(result,lens.tab);if(Array.isArray(ctx.diagnostics))ctx.diagnostics.push({image:safeImageLabel(lens.image),tab:lens.tab,upload:shape(upload.json),result:shape(result),nativeResultCount:nativeCount});if(nativeCount===0)return originalLensResponse(input,init,ctx,lens,'native_empty_result');return responseFor(result)}catch(e){if(Array.isArray(ctx.diagnostics))ctx.diagnostics.push({image:safeImageLabel(lens.image),tab:lens.tab,error:clean(e?.message||e).slice(0,260)});return originalLensResponse(input,init,ctx,lens,'native_error')}}
    }
    return baseFetch(input,init);
  }
}

export async function withBrightLensNativeContext(context,fn){installBrightLensNativeTransport();return contextStore.run(context||{},fn)}

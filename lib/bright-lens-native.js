import{AsyncLocalStorage}from'node:async_hooks';
import{ProxyAgent,fetch as proxyFetch,FormData}from'undici';

const API='https://api.brightdata.com';
const LENS_API='https://api.brightdata.com/request';
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
    const r=await proxyFetch('https://lens.google.com/v3/upload',{method:'POST',headers:{'x-brd-session':session},body:fd,dispatcher:agent,signal:AbortSignal.timeout(70000)}),raw=await r.text();if(!r.ok)throw Error(`bright_data_native_upload_${r.status}:${clean(raw).slice(0,220)}`);const json=safeJson(raw);if(!json||typeof json!=='object')throw Error('Bright Data native Lens upload returned invalid JSON.');return{json,agent,session};
  })();
  cacheSet(uploadCache,ck,{at:Date.now(),value:promise},24);return promise;
}

async function tabResult(upload,tab){
  if(tab==='exact_matches'&&Array.isArray(upload.json.exact_matches))return upload.json;
  if(tab==='products'&&Array.isArray(upload.json.products))return upload.json;
  if(tab==='visual_matches'&&Array.isArray(upload.json.visual_matches))return upload.json;
  const entry=(upload.json.tabs||[]).find(x=>x?.type===tab&&x?.link);
  if(entry?.link){try{const u=new URL(entry.link);u.searchParams.set('brd_json','1');const r=await proxyFetch(u.href,{headers:{'x-brd-session':upload.session},dispatcher:upload.agent,signal:AbortSignal.timeout(60000)}),raw=await r.text(),j=safeJson(raw);if(r.ok&&j&&typeof j==='object')return j}catch{}}
  if(tab==='visual_matches'&&Array.isArray(upload.json.images))return{...upload.json,visual_matches:upload.json.images};
  return tab==='exact_matches'?{...upload.json,exact_matches:[]}:{...upload.json,products:[]};
}

function responseFor(json){return new Response(JSON.stringify(json),{status:200,headers:{'content-type':'application/json','cache-control':'no-store','x-srl-lens-transport':'native-file-upload'}})}

export function installBrightLensNativeTransport(){
  if(installed)return;installed=true;
  globalThis.fetch=async function(input,init={}){
    const requestUrl=typeof input==='string'?input:input instanceof URL?input.href:input?.url||'';
    if(requestUrl===LENS_API&&typeof init?.body==='string'){
      let body;try{body=JSON.parse(init.body)}catch{body=null}const lens=imageTarget(body?.url);
      if(lens){const key=bearer(init.headers),zone=clean(body?.zone),ctx=contextStore.getStore()||{};if(!key||!zone)return baseFetch(input,init);const upload=await uploadImage(lens.image,key,zone,ctx.referer||'');const result=await tabResult(upload,lens.tab);return responseFor(result)}
    }
    return baseFetch(input,init);
  }
}

export async function withBrightLensNativeContext(context,fn){installBrightLensNativeTransport();return contextStore.run(context||{},fn)}

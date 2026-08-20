export const runtime='nodejs';
export const maxDuration=180;

import { POST as baseReferenceScan } from '../reference-scan/route';

const BRIGHT_URL='https://api.brightdata.com/request';
const BRIGHT_ZONE=process.env.BRIGHT_DATA_SERP_ZONE||'serp_api1';
const UA='Mozilla/5.0 (compatible; SyntheticReviewLab/1.0; +internal QA reference discovery)';
const BLOCKED_HOST=/(^localhost$|\.local$|^0\.|^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^\[?::1\]?$)/i;

function publicUrl(x){try{const u=new URL(x);if(!/^https?:$/.test(u.protocol)||BLOCKED_HOST.test(u.hostname))return null;return u}catch{return null}}
function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function isAmazon(x){return /(^|\.)amazon\.(com|ca|co\.uk|de|fr|it|es|com\.au|co\.jp|in|com\.mx|com\.br)$/i.test(host(x))}
function asinFrom(x){const s=String(x||'');return s.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1]?.toUpperCase()||s.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:&|$)/)?.[1]?.toUpperCase()||null}
function amazonCanonical(url){const u=publicUrl(url),asin=asinFrom(url);if(!u)return null;return asin?`https://${u.hostname}/dp/${asin}`:u.href}
function cleanText(s){return String(s||'').replace(/\s+/g,' ').trim()}
function safeJson(text){try{let x=JSON.parse(text);if(typeof x==='string'){try{x=JSON.parse(x)}catch{}}return x}catch{return null}}

async function heroFromProduct(productUrl){
  const u=publicUrl(productUrl);if(!u)return null;
  const r=await fetch(u,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(18000)});
  if(!r.ok)return null;
  const html=await r.text();
  const candidates=[];
  const add=x=>{if(!x||typeof x!=='string')return;try{const z=new URL(x,r.url);if(/^https?:$/.test(z.protocol)&&!candidates.includes(z.href))candidates.push(z.href)}catch{}};
  for(const m of html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/gi))add(m[1]);
  for(const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi))add(m[1]);
  for(const m of html.matchAll(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/gi))add(m[1]);
  if(candidates.length)return candidates[0];
  for(const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{
      const j=JSON.parse(m[1]);const stack=[j];
      while(stack.length){const v=stack.pop();if(!v||typeof v!=='object')continue;if(Array.isArray(v)){stack.push(...v);continue}const t=v['@type'];if(t==='Product'||(Array.isArray(t)&&t.includes('Product'))){const im=v.image;if(typeof im==='string')add(im);else if(Array.isArray(im))for(const x of im)add(typeof x==='string'?x:x?.url||x?.contentUrl);else if(im&&typeof im==='object')add(im.url||im.contentUrl)}stack.push(...Object.values(v))}
    }catch{}
  }
  return candidates[0]||null;
}

async function brightLens(tab,imageUrl,key){
  const lens=`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(imageUrl)}&brd_json=1&brd_lens=${encodeURIComponent(tab)}&hl=en&gl=US`;
  const r=await fetch(BRIGHT_URL,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({zone:BRIGHT_ZONE,url:lens,format:'raw'}),signal:AbortSignal.timeout(65000)});
  const raw=await r.text();
  if(!r.ok)throw Error(`Bright Data ${tab} HTTP ${r.status}: ${raw.slice(0,240)}`);
  const data=safeJson(raw);if(!data||typeof data!=='object')throw Error(`Bright Data ${tab} returned invalid JSON.`);
  return data;
}

function lensItems(tab,data){
  const arrays=[];
  if(tab==='exact_matches'&&Array.isArray(data.exact_matches))arrays.push(data.exact_matches);
  if(tab==='visual_matches'&&Array.isArray(data.visual_matches))arrays.push(data.visual_matches);
  if(tab==='products'&&Array.isArray(data.products))arrays.push(data.products);
  if(Array.isArray(data.images))arrays.push(data.images);
  const out=[],seen=new Set();
  for(const arr of arrays)for(const item of arr||[]){
    const link=publicUrl(item?.link||item?.url||item?.product_link)?.href;if(!link)continue;
    const k=link.replace(/#.*$/,'');if(seen.has(k))continue;seen.add(k);
    out.push({tab,link:k,title:cleanText(item?.title||item?.name||''),source:cleanText(item?.source||item?.merchant||''),rank:Number(item?.rank||item?.global_rank)||null,image:item?.image_url||((typeof item?.image==='string'&&!item.image.startsWith('data:'))?item.image:null)||null});
  }
  return out;
}

function scoreForTab(tab){return tab==='exact_matches'?.96:tab==='products'?.84:.68}
function confidence(score){return score>=.72?'high':score>=.5?'medium':score>=.35?'low':'none'}

function normalizeAmazonLens(items){
  const map=new Map();
  for(const x of items){if(!isAmazon(x.link))continue;const direct=amazonCanonical(x.link);if(!direct)continue;const asin=asinFrom(direct),key=asin||direct,score=scoreForTab(x.tab),old=map.get(key);if(old&&old.matchConfidence>=score)continue;map.set(key,{platform:host(direct)||'amazon.com',provider:'bright_data_google_lens',sourceUrl:direct,directSourceUrl:direct,asin,title:x.title||'Amazon',status:'aggregate_only',matchConfidence:score,confidence:confidence(score),publicReviewCount:null,countKind:null,extractedReviewCount:0,individualExtractedCount:0,pageCount:1,aggregateOnly:true,ratingEstimate:null,error:null,linkVerified:true,linkVerification:`bright_data_google_lens_${x.tab}`,lensTab:x.tab,lensRank:x.rank,syntheticUseOnly:true})}
  return [...map.values()].sort((a,b)=>(b.matchConfidence-a.matchConfidence)||((a.lensRank||999)-(b.lensRank||999))).slice(0,8);
}

function mergeSources(referenceSet,lensAmazon){
  const existing=Array.isArray(referenceSet.sourceCounts)?referenceSet.sourceCounts:[],seen=new Set(existing.map(x=>x.asin||x.directSourceUrl||x.sourceUrl).filter(Boolean)),merged=[...existing];
  for(const x of lensAmazon){const k=x.asin||x.directSourceUrl;if(seen.has(k))continue;seen.add(k);merged.unshift(x)}
  referenceSet.sourceCounts=merged;
  const agg=Array.isArray(referenceSet.aggregateOnlySources)?referenceSet.aggregateOnlySources:[],aggSeen=new Set(agg.map(x=>x.asin||x.directSourceUrl||x.sourceUrl).filter(Boolean));
  for(const x of lensAmazon){const k=x.asin||x.directSourceUrl;if(aggSeen.has(k))continue;aggSeen.add(k);agg.unshift({platform:x.platform,sourceUrl:x.sourceUrl,directSourceUrl:x.directSourceUrl,asin:x.asin,sameProductConfidence:x.matchConfidence,reviewCountEstimate:x.publicReviewCount,ratingEstimate:x.ratingEstimate,provider:x.provider,lensTab:x.lensTab})}
  referenceSet.aggregateOnlySources=agg;
  referenceSet.matchedPages=Math.max(Number(referenceSet.matchedPages)||0,merged.length?1:0);
  referenceSet.verifiedSourceLinks=merged.filter(x=>x.linkVerified).length;
  if(lensAmazon.length&&referenceSet.confidence==='none')referenceSet.confidence=lensAmazon.some(x=>x.confidence==='high')?'high':'medium';
}

export async function POST(req){
  const raw=await req.text();
  let input;try{input=JSON.parse(raw)}catch{return Response.json({error:'Invalid JSON body.'},{status:400})}
  const baseReq=new Request(req.url,{method:'POST',headers:req.headers,body:raw});
  const key=process.env.BRIGHT_DATA_API_KEY||'';
  const heroPromise=key?heroFromProduct(String(input?.productUrl||'' )).catch(()=>null):Promise.resolve(null);
  const basePromise=baseReferenceScan(baseReq);
  const [baseRes,hero]=await Promise.all([basePromise,heroPromise]);
  let base;try{base=await baseRes.json()}catch{return baseRes}
  if(!base?.referenceSet)return Response.json(base,{status:baseRes.status});
  const rs=base.referenceSet;
  rs.version='individual-reference-v10';
  rs.lensDiscovery={enabled:Boolean(key),provider:'bright_data_google_lens',zone:BRIGHT_ZONE,status:key?'pending':'missing_api_key',heroImageUrl:hero||rs?.provenance?.heroImageUrl||null,tabs:{},amazonMatches:0};
  if(!key){rs.lensDiscovery.status='missing_api_key';return Response.json(base,{status:baseRes.status})}
  const imageUrl=hero||rs?.provenance?.heroImageUrl||rs?.provenance?.heroImageFinalUrl;
  if(!imageUrl){rs.lensDiscovery.status='no_hero_image';return Response.json(base,{status:baseRes.status})}
  const tabs=['exact_matches','products','visual_matches'];
  const settled=await Promise.allSettled(tabs.map(tab=>brightLens(tab,imageUrl,key)));
  const items=[];let ok=0;
  for(let i=0;i<tabs.length;i++){
    const tab=tabs[i],s=settled[i];
    if(s.status==='fulfilled'){const list=lensItems(tab,s.value);items.push(...list);rs.lensDiscovery.tabs[tab]={ok:true,results:list.length,amazon:list.filter(x=>isAmazon(x.link)).length};ok++}
    else rs.lensDiscovery.tabs[tab]={ok:false,error:cleanText(s.reason?.message||String(s.reason)).slice(0,260)};
  }
  const lensAmazon=normalizeAmazonLens(items);
  mergeSources(rs,lensAmazon);
  rs.lensDiscovery.status=ok?'complete':'failed';
  rs.lensDiscovery.amazonMatches=lensAmazon.length;
  rs.lensDiscovery.totalResults=items.length;
  rs.lensDiscovery.tabsSucceeded=ok;
  rs.amazonPriority=true;
  rs.amazonResolutionStrategy='bright_data_google_lens_exact_products_visual_plus_existing_search';
  rs.provider=lensAmazon.length?'bright_data_lens_plus_existing_reference_scan':rs.provider;
  rs.provenance={...(rs.provenance||{}),brightDataLensUsed:true,brightDataLensAmazonMatches:lensAmazon.length,brightDataLensResults:items.length};
  return Response.json(base,{status:baseRes.status});
}

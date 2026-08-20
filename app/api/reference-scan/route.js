export const runtime='nodejs';
export const maxDuration=180;
import{gatewayToken}from'../../../lib/gateway';
import{extractReviews,ingestReviewsFromPage,isAmazonUrl,amazonAsin}from'../../../lib/review-ingest';

const DISCOVERY_MODEL='google/gemini-3.6-flash';
const GATEWAY_URL='https://ai-gateway.vercel.sh/v1/responses';
const UA='Mozilla/5.0 (compatible; SyntheticReviewLab/1.0; +internal QA reference discovery)';
const BLOCKED_HOST=/(^localhost$|\.local$|^0\.|^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^\[?::1\]?$)/i;

function publicUrl(x){try{const u=new URL(x);if(!/^https?:$/.test(u.protocol)||BLOCKED_HOST.test(u.hostname))return null;return u}catch{return null}}
function cleanText(s){return String(s||'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim()}
function num(v){if(v==null)return null;const n=Number(String(v).replace(/[^0-9.]/g,''));return Number.isFinite(n)&&n>=0?n:null}
function countNum(v){if(v==null)return null;const s=String(v).trim().toLowerCase().replace(/,/g,''),m=s.match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/i);if(!m)return null;let n=Number(m[1]);if(!Number.isFinite(n)||n<0)return null;const mult=m[2]==='k'?1e3:m[2]==='m'?1e6:m[2]==='b'?1e9:1;n*=mult;return n<=1000000000?Math.round(n):null}
function host(x){try{return new URL(x).hostname.replace(/^www\./,'')}catch{return''}}
function canonical(x){try{const u=new URL(x);u.hash='';for(const k of[...u.searchParams.keys()])if(/^utm_|^(ref|tag|source|campaign)$/i.test(k))u.searchParams.delete(k);return u.href}catch{return x}}
function confidence(score){return score>=.72?'high':score>=.5?'medium':score>=.35?'low':'none'}

async function getHtml(url,timeout=14000){
  const u=publicUrl(url);if(!u)throw Error('Unsafe or invalid public URL.');
  const r=await fetch(u,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(timeout)});
  const html=await r.text();
  if(r.status===403||r.status===429||/captcha|robot check|verify you are human|access denied/i.test(html.slice(0,5000)))throw Error('blocked_or_challenged');
  if(!r.ok)throw Error(`HTTP ${r.status}`);
  return{html,url:r.url}
}
function jsonScripts(html){const out=[];for(const m of String(html||'').matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)){const type=m[0].match(/type=["']([^"']+)/i)?.[1]||'',t=m[1].trim();if(!t||t.length>2500000)continue;if(!/json/i.test(type)&&!/^[\[{]/.test(t))continue;try{out.push(JSON.parse(t))}catch{}}return out}
function walk(x,fn,seen=new Set()){if(!x||typeof x!=='object'||seen.has(x))return;seen.add(x);fn(x);if(Array.isArray(x))for(const v of x)walk(v,fn,seen);else for(const v of Object.values(x))walk(v,fn,seen)}
function pageTitle(html){return cleanText(String(html||'').match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||String(html||'').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')}
function imagesFrom(html,base){const found=[];const add=x=>{if(Array.isArray(x))return x.forEach(add);if(x&&typeof x==='object')return add(x.url||x.contentUrl);if(typeof x!=='string')return;try{const u=new URL(x,base);if(/^https?:$/.test(u.protocol)&&!found.includes(u.href))found.push(u.href)}catch{}};for(const j of jsonScripts(html))walk(j,o=>{const t=o?.['@type'];if(t==='Product'||(Array.isArray(t)&&t.includes('Product')))add(o.image)});for(const re of[/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/gi,/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/gi,/<img[^>]+src=["']([^"']+)/gi])for(const m of String(html||'').matchAll(re))add(m[1]);return found.slice(0,4)}
function tokens(s){return new Set(cleanText(s).toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(/\s+/).filter(x=>x.length>2&&!['the','and','for','with','from','this','that','your'].includes(x)))}
function overlap(a,b){a=tokens(a);b=tokens(b);if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return n/Math.min(a.size,b.size)}

function reviewCountFromHtml(html){
  let best=null;
  const take=v=>{const n=countNum(v);if(n!=null&&n<=100000000)best=best==null?n:Math.max(best,n)};
  for(const j of jsonScripts(html))walk(j,o=>{
    if(!o||typeof o!=='object')return;
    const t=o['@type'];
    if(t==='Product'||(Array.isArray(t)&&t.includes('Product'))){take(o.aggregateRating?.reviewCount);take(o.aggregateRating?.ratingCount)}
    for(const k of['reviewCount','review_count','reviews_count','total_reviews','totalReviews','ratingCount','ratingsCount','review_count_total','totalReviewCount'])if(o[k]!=null)take(o[k]);
  });
  const text=String(html||'');
  const patterns=[
    /data-(?:product-)?reviews?-count=["']([\d,.]+)["']/i,
    /data-review-count=["']([\d,.]+)["']/i,
    /data-rating-count=["']([\d,.]+)["']/i,
    /["'](?:reviewCount|review_count|reviews_count|total_reviews|totalReviews|ratingCount|ratingsCount|totalReviewCount)["']\s*[:=]\s*["']?([\d,.]+)/i,
    /([\d,.]+)\s+(?:verified\s+|customer\s+)?reviews?\b/i,
    /([\d,.]+)\s+ratings?\b/i
  ];
  for(const re of patterns){const m=text.match(re);if(m)take(m[1])}
  return best
}

function extractText(j){if(typeof j?.output_text==='string'&&j.output_text.trim())return j.output_text;if(Array.isArray(j?.output))for(const o of j.output||[])for(const c of o?.content||[])if(typeof c?.text==='string'&&c.text.trim())return c.text;return''}
function searchSources(j){const out=[];const add=x=>{const u=publicUrl(x);if(u&&!out.includes(u.href))out.push(u.href)};for(const o of j?.output||[]){if(o?.type==='web_search_call'){for(const s of o?.action?.sources||[])add(s?.url);if(o?.action?.url)add(o.action.url)}for(const c of o?.content||[])for(const a of c?.annotations||[])add(a?.url||a?.url_citation?.url)}return out}
function parseLooseObject(text){const s=String(text||'').replace(/```(?:json)?/gi,'').replace(/```/g,'');let start=-1,depth=0,quoted=false,esc=false;for(let i=0;i<s.length;i++){const ch=s[i];if(start<0){if(ch==='{'){start=i;depth=1}continue}if(quoted){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')quoted=false;continue}if(ch==='"'){quoted=true;continue}if(ch==='{')depth++;else if(ch==='}'&&--depth===0)return JSON.parse(s.slice(start,i+1))}throw Error('Discovery model returned invalid JSON.')}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36).toUpperCase()}
function sentenceCount(s){return Math.max(1,(String(s).match(/[.!?]+(?:\s|$)/g)||[]).length)}

async function aiDiscover(req,{productTitle,productDescription,images,sourceUrl}){
  const token=gatewayToken(req);if(!token)throw Error('AI Gateway authentication is unavailable.');
  const prompt=`You are an image-first exact-product discovery agent for INTERNAL QA MODELING. Treat the supplied FIRST/HERO PRODUCT IMAGE as the primary identity signal. Use web search to find ecommerce product pages showing the same exact physical product or a visually identical/private-label version. The task is closer to reverse-image product search than generic semantic product search.\n\nPrioritize visual identity first: silhouette, geometry, component placement, materials, colors, surface details, ports/buttons, packaging, included accessories, printed text/logos/model numbers, and distinctive construction. Use the official product title/context only as supporting evidence. Do NOT accept a merely similar product because its category or keywords match. Exclude the source store itself. Prioritize sources with customer reviews: Amazon, AliExpress, Walmart, eBay, Temu, Etsy, manufacturer/reseller pages, and stores using Judge.me/Yotpo/Loox/Stamped when relevant. Do not quote or reproduce review text.\n\nFor each candidate, if public indexed information exposes the TOTAL review/rating count for that exact listing, include it. Do not invent a count; use null when unavailable.\nSOURCE URL: ${sourceUrl}\nPRODUCT TITLE: ${productTitle}\nOFFICIAL PRODUCT CONTEXT:\n${productDescription}\nReturn ONLY one JSON object: {"visualSignals":["..."],"queries":["..."],"candidates":[{"url":"https://...","matchConfidence":0.0,"matchReason":"specific visual evidence","reviewCountEstimate":null,"ratingEstimate":null}]}. Return at most 20 candidates. Give high matchConfidence only when the listing appears to show the same physical product, not merely the same product type.`;
  const content=[{type:'input_text',text:prompt},...images.slice(0,1).map(image_url=>({type:'input_image',image_url,detail:'high'}))];
  const r=await fetch(GATEWAY_URL,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({model:DISCOVERY_MODEL,input:[{type:'message',role:'user',content}],tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'auto',include:['web_search_call.action.sources'],store:false}),signal:AbortSignal.timeout(80000)});
  const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{j=null}if(!r.ok)throw Error(j?.error?.message||j?.message||raw.slice(0,400)||`AI Gateway HTTP ${r.status}`);
  const text=extractText(j),sources=searchSources(j);let parsed={};try{parsed=parseLooseObject(text)}catch{}
  return{visualSignals:Array.isArray(parsed.visualSignals)?parsed.visualSignals.slice(0,12):[],queries:Array.isArray(parsed.queries)?parsed.queries.slice(0,12):[],candidates:Array.isArray(parsed.candidates)?parsed.candidates:[],sources}
}

async function fillMissingCounts(req,{productTitle,productDescription,pages}){
  const need=pages.filter(p=>p&&p.matchScore>=.4&&p.publicReviewCount==null).slice(0,10);if(!need.length)return;
  const token=gatewayToken(req);if(!token)return;
  const prompt=`For INTERNAL QA MODELING, use public web search to inspect these already-discovered ecommerce product listings. Do not quote reviews and do not bypass access controls. For each URL, return the public TOTAL review/rating count only when you can reasonably verify it from indexed public information. Also return sameProductConfidence relative to the official product. Never invent a count; null is preferred to guessing.\nPRODUCT: ${productTitle}\nOFFICIAL CONTEXT:\n${productDescription}\nLISTINGS:\n${JSON.stringify(need.map(p=>({url:p.url,platform:host(p.url),existingMatchConfidence:p.matchScore})))}\nReturn ONLY JSON: {"sources":[{"url":"https://...","reviewCountEstimate":null,"ratingEstimate":null,"sameProductConfidence":0.0}]}`;
  try{
    const r=await fetch(GATEWAY_URL,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({model:DISCOVERY_MODEL,input:prompt,tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'auto',store:false}),signal:AbortSignal.timeout(70000)});
    const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{j=null}if(!r.ok)return;let parsed={};try{parsed=parseLooseObject(extractText(j))}catch{return}
    const found=Array.isArray(parsed.sources)?parsed.sources:[];
    for(const p of need){const f=found.find(x=>canonical(x?.url||'')===canonical(p.url));if(!f)continue;const n=countNum(f.reviewCountEstimate);if(n!=null){p.publicReviewCount=n;p.countKind='web_estimate'}const conf=num(f.sameProductConfidence);if(conf!=null&&conf<=1){p.matchScore=Math.max(p.matchScore,Math.min(1,conf));p.confidence=confidence(p.matchScore)}if(p.ratingEstimate==null){const rt=num(f.ratingEstimate);if(rt!=null&&rt<=5)p.ratingEstimate=rt}}
  }catch{}
}

function buildReferenceRecords(pages){const out=[],seen=new Set();for(const p of pages){if(!p?.reviews?.length)continue;const provider=(p.ingestion?.providers||[]).find(x=>x&&x!=='amazon')||null,platform=host(p.url)||'unknown';for(const r of p.reviews){const body=cleanText(r.body).slice(0,1400);if(body.length<10)continue;const key=body.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(!key||seen.has(key))continue;seen.add(key);out.push({referenceId:`REF-${hash(key)}`,platform,provider,sourceUrl:p.url,sourceRating:Number(r.rating)||null,sourceTitle:cleanText(r.title||'').slice(0,180),sourceBody:body,wordCount:body.split(/\s+/).filter(Boolean).length,sentenceCount:sentenceCount(body)});if(out.length>=1200)return out}}return out}
function platformCounts(refs){const map=new Map();for(const r of refs){const key=`${r.platform}|${r.provider||''}`,x=map.get(key)||{platform:r.platform,provider:r.provider,reviewCount:0,pages:new Set()};x.reviewCount++;x.pages.add(r.sourceUrl);map.set(key,x)}return[...map.values()].map(x=>({platform:x.platform,provider:x.provider,reviewCount:x.reviewCount,pageCount:x.pages.size})).sort((a,b)=>b.reviewCount-a.reviewCount)}
function sourceCounts(pages){return pages.filter(p=>p&&p.matchScore>=.4).map(p=>({platform:host(p.url)||'unknown',provider:(p.ingestion?.providers||[])[0]||(/amazon\./i.test(host(p.url))?'amazon':null),sourceUrl:p.url,title:p.title||null,status:p.status||'found',matchConfidence:Number(p.matchScore.toFixed(3)),confidence:p.confidence||confidence(p.matchScore),publicReviewCount:p.publicReviewCount??null,countKind:p.countKind||null,extractedReviewCount:0,individualExtractedCount:Number(p.reviewCount)||0,pageCount:1,aggregateOnly:Boolean(isAmazonUrl(p.url)),ratingEstimate:p.ratingEstimate??null,error:p.error||null})).sort((a,b)=>(Number(b.publicReviewCount)||Number(b.extractedReviewCount)||0)-(Number(a.publicReviewCount)||Number(a.extractedReviewCount)||0))}

export async function POST(req){try{
  const input=await req.json(),productUrl=String(input.productUrl||'').trim(),productTitle=cleanText(input.productTitle||''),productDescription=cleanText(input.productDescription||'');
  if(!productUrl||!productTitle)throw Error('Product URL and title are required.');
  const source=await getHtml(productUrl,20000),images=imagesFrom(source.html,source.url);if(!images.length)throw Error('No public product images were found for visual discovery.');
  const discovery=await aiDiscover(req,{productTitle,productDescription,images,sourceUrl:source.url}),sourceHost=host(source.url),map=new Map();
  const add=(url,confidenceValue=.35,reason='web-search source',meta={})=>{const u=publicUrl(url);if(!u||host(u.href)===sourceHost)return;const k=canonical(u.href),old=map.get(k)||{url:k,aiConfidence:0,matchReason:'',discoveryReviewCount:null,ratingEstimate:null};old.aiConfidence=Math.max(old.aiConfidence,Math.max(0,Math.min(1,Number(confidenceValue)||0)));if(reason)old.matchReason=cleanText(reason).slice(0,220);const rc=countNum(meta.reviewCountEstimate);if(rc!=null)old.discoveryReviewCount=old.discoveryReviewCount==null?rc:Math.max(old.discoveryReviewCount,rc);const rt=num(meta.ratingEstimate);if(rt!=null&&rt<=5)old.ratingEstimate=rt;map.set(k,old)};
  for(const c of discovery.candidates)add(c?.url,c?.matchConfidence,c?.matchReason,c||{});for(const u of discovery.sources)add(u,.35,'AI web-search source');
  const candidates=[...map.values()].sort((a,b)=>b.aiConfidence-a.aiConfidence).slice(0,18),pages=[];let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=candidates.length)return;const c=candidates[i];
    if(isAmazonUrl(c.url)){const score=Math.max(c.aiConfidence,c.discoveryReviewCount!=null?.5:0),asin=amazonAsin(c.url);pages[i]={...c,url:c.url,title:'Amazon',status:'aggregate_only',matchScore:score,confidence:confidence(score),reviewCount:0,reviews:[],publicReviewCount:c.discoveryReviewCount,countKind:c.discoveryReviewCount!=null?'web_estimate':null,ratingEstimate:c.ratingEstimate,asin,ingestion:{mode:'amazon_aggregate_only',providers:['amazon'],embedded:0,paginationPagesFetched:0,providerEndpointsFetched:0,blocked:0,failed:0}};continue}
    try{
      const p=await getHtml(c.url,12000),title=pageTitle(p.html),titleOverlap=overlap(productTitle,title||p.html.slice(0,5000)),preScore=c.aiConfidence*.62+titleOverlap*.38,visibleCount=reviewCountFromHtml(p.html);let ing;
      if(preScore>=.34)ing=await ingestReviewsFromPage({html:p.html,url:p.url,maxPages:4,maxEndpoints:6});else{const reviews=extractReviews(p.html);ing={reviews,diagnostics:{providers:[],embedded:reviews.length,paginationPagesFetched:0,providerEndpointsFetched:0,blocked:0,failed:0}}}
      const reviews=ing.reviews,reviewBoost=reviews.length?0.08:0,matchScore=Math.min(1,c.aiConfidence*.58+titleOverlap*.34+reviewBoost),publicReviewCount=visibleCount??c.discoveryReviewCount;
      pages[i]={...c,url:p.url,title,status:'found',titleOverlap:Number(titleOverlap.toFixed(3)),matchScore:Number(matchScore.toFixed(3)),confidence:confidence(matchScore),reviewCount:reviews.length,reviews,publicReviewCount,countKind:visibleCount!=null?'page':c.discoveryReviewCount!=null?'web_estimate':null,ratingEstimate:c.ratingEstimate,ingestion:{mode:'provider_aware',...ing.diagnostics}}
    }catch(e){const score=Math.max(c.aiConfidence,c.discoveryReviewCount!=null?.5:0);pages[i]={...c,title:null,status:String(e.message).includes('blocked')?'blocked':'unavailable',matchScore:Number(score.toFixed(3)),confidence:confidence(score),reviewCount:0,reviews:[],publicReviewCount:c.discoveryReviewCount,countKind:c.discoveryReviewCount!=null?'web_estimate':null,ratingEstimate:c.ratingEstimate,error:e.message,ingestion:{mode:'unavailable',providers:[],embedded:0,paginationPagesFetched:0,providerEndpointsFetched:0,blocked:String(e.message).includes('blocked')?1:0,failed:String(e.message).includes('blocked')?0:1}}}
  }}
  await Promise.all(Array.from({length:Math.min(5,candidates.length)},worker));
  const accepted=pages.filter(Boolean).filter(x=>x.matchScore>=.4);await fillMissingCounts(req,{productTitle,productDescription,pages:accepted});
  const refs=buildReferenceRecords(accepted),counts=platformCounts(refs),sources=sourceCounts(accepted),amazonAggregate=sources.filter(x=>x.aggregateOnly).map(x=>({platform:x.platform,sourceUrl:x.sourceUrl,asin:amazonAsin(x.sourceUrl),sameProductConfidence:x.matchConfidence,reviewCountEstimate:x.publicReviewCount,ratingEstimate:x.ratingEstimate}));
  const referencePages=accepted.filter(x=>x.reviewCount>0||x.publicReviewCount!=null||x.status==='blocked'||isAmazonUrl(x.url)),conf=referencePages.some(x=>x.confidence==='high')?'high':referencePages.some(x=>x.confidence==='medium')?'medium':referencePages.length?'low':'none';
  const ingestion=accepted.reduce((z,p)=>{const d=p.ingestion||{};z.embedded+=Number(d.embedded)||0;z.paginationPagesFetched+=Number(d.paginationPagesFetched)||0;z.providerEndpointsFetched+=Number(d.providerEndpointsFetched)||0;z.blocked+=Number(d.blocked)||0;z.failed+=Number(d.failed)||0;for(const k of d.providers||[])z.providers.add(k);return z},{embedded:0,paginationPagesFetched:0,providerEndpointsFetched:0,blocked:0,failed:0,providers:new Set()});
  return Response.json({referenceSet:{version:'individual-reference-v2',provider:'vercel_ai_gateway_gemini_hero_image_plus_provider_aware_ingestion',discoveryModel:DISCOVERY_MODEL,productUrl:source.url,productTitle,totalIndividualReviews:refs.length,availableForGeneration:Math.min(250,refs.length),platformCounts:counts,sourceCounts:sources,aggregateOnlySources:amazonAggregate,references:refs.slice(0,250),confidence:conf,matchedPages:referencePages.length,candidatePages:map.size,ingestion:{embedded:ingestion.embedded,paginationPagesFetched:ingestion.paginationPagesFetched,providerEndpointsFetched:ingestion.providerEndpointsFetched,blocked:ingestion.blocked,failed:ingestion.failed,providers:[...ingestion.providers]},provenance:{imagesScanned:1,heroImage:images[0],searchQueries:discovery.queries,searchSources:discovery.sources.length,generatedAt:new Date().toISOString()},syntheticUseOnly:true,sourceReviewTextExported:false}})
}catch(e){return Response.json({error:e.message||'External reference scan failed.'},{status:400})}}

export const runtime='nodejs';
export const maxDuration=180;

import{withBrightLensNativeContext}from'../../../lib/bright-lens-native';
import{ingestMarketplaceSource}from'../../../lib/marketplace-review-ingest';

const BD='https://api.brightdata.com';
let cachedZone=null;

function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function hash(s){let h=2166136261;for(let i=0;i<String(s).length;i++){h^=String(s).charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36).toUpperCase()}
function sent(s){return Math.max(1,(String(s).match(/[.!?]+(?:\s|$)/g)||[]).length)}

async function getActiveZones(key){
  const r=await fetch(`${BD}/zone/get_active_zones`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
  const raw=await r.text();
  if(!r.ok)throw Error(`Bright Data zone lookup HTTP ${r.status}: ${clean(raw).slice(0,220)}`);
  let zones;try{zones=JSON.parse(raw)}catch{throw Error('Bright Data zone lookup returned invalid JSON.')}
  if(!Array.isArray(zones))throw Error('Bright Data zone lookup returned an unexpected response.');
  return zones;
}

async function resolveSerpZone(key){
  if(cachedZone)return{zone:cachedZone,source:'cache',activeSerpZones:[cachedZone]};
  const configured=clean(process.env.BRIGHT_DATA_SERP_ZONE),zones=await getActiveZones(key),serp=zones.filter(z=>String(z?.type||'').toLowerCase()==='serp'&&z?.name);
  if(configured){const match=serp.find(z=>z.name===configured);if(match){cachedZone=match.name;return{zone:match.name,source:'environment',activeSerpZones:serp.map(z=>z.name)}}}
  if(!serp.length)throw Error('Bright Data API key is valid, but this account has no active SERP API zone. Create or activate a SERP API zone in Bright Data, then rescan.');
  cachedZone=serp[0].name;return{zone:serp[0].name,source:'auto_detected',activeSerpZones:serp.map(z=>z.name)};
}

function recomputePlatformCounts(refs){const m=new Map();for(const r of refs||[]){const k=`${r.platform}|${r.provider||''}`,x=m.get(k)||{platform:r.platform,provider:r.provider,reviewCount:0,pages:new Set()};x.reviewCount++;x.pages.add(r.sourceUrl);m.set(k,x)}return[...m.values()].map(x=>({platform:x.platform,provider:x.provider,reviewCount:x.reviewCount,pageCount:x.pages.size})).sort((a,b)=>b.reviewCount-a.reviewCount)}
function stripOriginalStore(rs,originalProductUrl){const h=host(originalProductUrl);if(!h||!rs)return rs;rs.sourceCounts=(rs.sourceCounts||[]).filter(x=>host(x.directSourceUrl||x.sourceUrl)!==h);rs.aggregateOnlySources=(rs.aggregateOnlySources||[]).filter(x=>host(x.directSourceUrl||x.sourceUrl)!==h);rs.references=(rs.references||[]).filter(x=>host(x.sourceUrl)!==h);rs.platformCounts=recomputePlatformCounts(rs.references);rs.totalIndividualReviews=rs.references.length;rs.availableForGeneration=Math.min(250,rs.references.length);rs.matchedPages=rs.sourceCounts.length;rs.verifiedSourceLinks=rs.sourceCounts.filter(x=>x.linkVerified).length;return rs}

async function enrichMarketplaceReviews(rs){
  if(!rs)return rs;
  const sources=(rs.sourceCounts||[]).filter(x=>{const h=host(x.directSourceUrl||x.sourceUrl);return /(^|\.)amazon\./i.test(h)||/(^|\.)ebay\./i.test(h)}).slice(0,6);
  if(!sources.length)return rs;
  const existing=new Set((rs.references||[]).map(r=>clean(r.sourceBody).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()).filter(Boolean));
  const diagnostics=[];
  const results=await Promise.all(sources.map(async src=>{try{return{src,result:await ingestMarketplaceSource(src,{maxPages:3,maxReviews:120})}}catch(e){return{src,result:{reviews:[],provider:null,attempted:0,blocked:0,failed:1,error:clean(e?.message||e)}}}}));
  const appended=[];
  for(const {src,result} of results){
    const sourceUrl=src.directSourceUrl||src.sourceUrl||'',platform=host(sourceUrl)||src.platform||'',provider=result.provider||src.provider||'marketplace';
    let added=0;
    for(const r of result.reviews||[]){
      const body=clean(r.body),k=body.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(!k||existing.has(k))continue;existing.add(k);
      appended.push({referenceId:`REF-${hash(`${sourceUrl}|${body}`).slice(0,8)}`,platform,provider,sourceUrl,sourceRating:r.rating??null,sourceTitle:clean(r.title).slice(0,220),sourceBody:body,wordCount:body.split(/\s+/).filter(Boolean).length,sentenceCount:sent(body)});added++;
    }
    const row=(rs.sourceCounts||[]).find(x=>(x.directSourceUrl||x.sourceUrl)===sourceUrl);if(row&&added){row.individualExtractedCount=(Number(row.individualExtractedCount)||Number(row.extractedReviewCount)||Number(row.reviewCount)||0)+added;row.extractedReviewCount=row.individualExtractedCount;row.reviewCount=row.individualExtractedCount;row.aggregateOnly=false;row.provider=provider;row.status='found'}
    diagnostics.push({sourceUrl,platform,provider,attempted:result.attempted||0,blocked:result.blocked||0,failed:result.failed||0,extracted:added,error:result.error||''});
  }
  rs.references=[...(rs.references||[]),...appended].slice(0,250);
  rs.platformCounts=recomputePlatformCounts(rs.references);rs.totalIndividualReviews=rs.references.length;rs.availableForGeneration=Math.min(250,rs.references.length);
  if(appended.length){const active=new Set((rs.references||[]).map(r=>r.sourceUrl));rs.aggregateOnlySources=(rs.aggregateOnlySources||[]).filter(x=>!active.has(x.directSourceUrl||x.sourceUrl))}
  rs.marketplaceIngestion={attemptedSources:sources.length,appendedReviews:appended.length,sources:diagnostics};
  return rs;
}

function emptyScanDiagnostic(rs,transport){
  const l=rs?.lensDiscovery||{},v=rs?.verificationDiagnostics||{};
  return{sourceImages:Array.isArray(l.sourceImages)?l.sourceImages.length:null,lensRequests:l.requests??l.lensRequests??null,lensRequestsSucceeded:l.succeeded??null,rawResults:l.rawResults??null,uniqueCandidates:l.uniqueCandidates??null,acceptedCandidates:l.acceptedCandidates??null,rejectedCandidates:l.rejectedCandidates??null,verifierCandidates:v.candidates??null,verifierAccepted:v.accepted??null,verifierRejected:v.rejected??null,amazonCandidates:l.amazonCandidates??null,amazonAccepted:l.amazonAccepted??null,tabs:l.tabs||null,transport:(transport||[]).slice(0,12)};
}

export async function POST(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'';if(!key)return Response.json({error:'Bright Data Lens is not configured.'},{status:400});
  let zoneInfo;try{zoneInfo=await resolveSerpZone(key)}catch(e){return Response.json({error:e?.message||String(e),brightData:{stage:'zone_discovery'}},{status:400,headers:{'cache-control':'no-store'}})}
  process.env.BRIGHT_DATA_SERP_ZONE=zoneInfo.zone;
  let body;try{body=await req.json()}catch{return Response.json({error:'Invalid JSON body.'},{status:400})}
  const originalProductUrl=String(body?.productUrl||'').trim();if(!originalProductUrl)return Response.json({error:'Product URL is required.'},{status:400});
  const forwarded=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(body)});
  const mod=await import('../reference-scan-v11/route.js');
  const transportDiagnostics=[];
  let res;
  try{res=await withBrightLensNativeContext({referer:originalProductUrl,diagnostics:transportDiagnostics},()=>mod.POST(forwarded))}
  catch(e){return Response.json({error:`Native Google Lens image upload failed: ${e?.message||String(e)}`,brightData:{stage:'native_file_upload',zone:zoneInfo.zone,zoneSource:zoneInfo.source,activeSerpZones:zoneInfo.activeSerpZones},transportDiagnostics},{status:400,headers:{'cache-control':'no-store'}})}
  let json;try{json=await res.clone().json()}catch{return res}
  if(res.ok&&json?.referenceSet){
    json.referenceSet.productUrl=originalProductUrl;
    json.referenceSet=stripOriginalStore(json.referenceSet,originalProductUrl);
    json.referenceSet=await enrichMarketplaceReviews(json.referenceSet);
    json.referenceSet.provenance={...(json.referenceSet.provenance||{}),imageTransport:'bright_data_native_file_upload',originalProductUrl};
    json.referenceSet.lensDiscovery={...(json.referenceSet.lensDiscovery||{}),transport:'native_file_upload'};
    if(!(json.referenceSet.sourceCounts||[]).length){const d=emptyScanDiagnostic(json.referenceSet,transportDiagnostics);const t=d.transport?.[0]||{};return Response.json({error:`Google Lens scan returned no usable external sources. rawResults=${d.rawResults??'n/a'}, uniqueCandidates=${d.uniqueCandidates??'n/a'}, acceptedCandidates=${d.acceptedCandidates??'n/a'}, verifierAccepted=${d.verifierAccepted??'n/a'}. transport=${t.error?`error:${t.error}`:`uploadKeys:${(t.upload?.keys||[]).join('|')||'none'}, images:${t.upload?.images??'n/a'}, tabs:${(t.upload?.tabs||[]).join('|')||'none'}`}.`,brightData:{stage:'empty_verified_source_set',zone:zoneInfo.zone,zoneSource:zoneInfo.source,imageTransport:'bright_data_native_file_upload'},diagnostics:d},{status:400,headers:{'cache-control':'no-store'}})}
    return Response.json(json,{status:res.status,headers:{'cache-control':'no-store'}})
  }
  if(String(json?.error||'').includes('Google Lens discovery failed for every product image'))return Response.json({error:`${json.error} Native file upload transport was active, so the failure is now inside Bright Data/Google Lens response handling rather than image URL reachability.`,brightData:{stage:'native_lens_response',zone:zoneInfo.zone,zoneSource:zoneInfo.source,activeSerpZones:zoneInfo.activeSerpZones,imageTransport:'bright_data_native_file_upload'},transportDiagnostics},{status:400,headers:{'cache-control':'no-store'}});
  return Response.json(json,{status:res.status,headers:{'cache-control':'no-store'}})
}

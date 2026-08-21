export const runtime='nodejs';
export const maxDuration=300;

import{withBrightLensNativeContext}from'../../../lib/bright-lens-native';

const BD='https://api.brightdata.com';
let cachedZone=null;

function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}

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

function emptyScanDiagnostic(rs,transport){
  const l=rs?.lensDiscovery||{},v=rs?.verificationDiagnostics||{};
  return{sourceImages:Array.isArray(l.sourceImages)?l.sourceImages.length:null,lensRequests:l.requests??l.lensRequests??null,lensRequestsSucceeded:l.succeeded??null,rawResults:l.rawResults??null,uniqueCandidates:l.uniqueCandidates??null,acceptedCandidates:l.acceptedCandidates??null,rejectedCandidates:l.rejectedCandidates??null,verifierCandidates:v.candidates??null,verifierAccepted:v.accepted??null,verifierRejected:v.rejected??null,amazonCandidates:l.amazonCandidates??null,amazonAccepted:l.amazonAccepted??null,amazonFallback:rs?.amazonFallbackDiscovery||null,tabs:l.tabs||null,transport:(transport||[]).slice(0,12)};
}

export async function POST(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'';if(!key)return Response.json({error:'Bright Data Lens is not configured.'},{status:400});
  let zoneInfo;try{zoneInfo=await resolveSerpZone(key)}catch(e){return Response.json({error:e?.message||String(e),brightData:{stage:'zone_discovery'}},{status:400,headers:{'cache-control':'no-store'}})}
  process.env.BRIGHT_DATA_SERP_ZONE=zoneInfo.zone;
  let body;try{body=await req.json()}catch{return Response.json({error:'Invalid JSON body.'},{status:400})}
  const originalProductUrl=String(body?.productUrl||'').trim();if(!originalProductUrl)return Response.json({error:'Product URL is required.'},{status:400});
  const forwarded=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(body)});
  const mod=await import('../reference-scan-v12/route.js');
  const transportDiagnostics=[];
  let res;
  try{res=await withBrightLensNativeContext({referer:originalProductUrl,diagnostics:transportDiagnostics},()=>mod.POST(forwarded))}
  catch(e){return Response.json({error:`Native Google Lens image upload failed: ${e?.message||String(e)}`,brightData:{stage:'native_file_upload',zone:zoneInfo.zone,zoneSource:zoneInfo.source,activeSerpZones:zoneInfo.activeSerpZones},transportDiagnostics},{status:400,headers:{'cache-control':'no-store'}})}
  let json;try{json=await res.clone().json()}catch{return res}
  if(res.ok&&json?.referenceSet){
    json.referenceSet.productUrl=originalProductUrl;
    json.referenceSet=stripOriginalStore(json.referenceSet,originalProductUrl);
    json.referenceSet.provenance={...(json.referenceSet.provenance||{}),imageTransport:'bright_data_native_file_upload',originalProductUrl};
    json.referenceSet.lensDiscovery={...(json.referenceSet.lensDiscovery||{}),transport:'native_file_upload'};
    if(!(json.referenceSet.sourceCounts||[]).length){const d=emptyScanDiagnostic(json.referenceSet,transportDiagnostics);const t=d.transport?.[0]||{};return Response.json({error:`Reference scan returned no verified external sources after Lens and Amazon fallback. rawResults=${d.rawResults??'n/a'}, uniqueCandidates=${d.uniqueCandidates??'n/a'}, verifierAccepted=${d.verifierAccepted??'n/a'}. transport=${t.error?`error:${t.error}`:`uploadKeys:${(t.upload?.keys||[]).join('|')||'none'}, images:${t.upload?.images??'n/a'}, tabs:${(t.upload?.tabs||[]).join('|')||'none'}`}.`,brightData:{stage:'empty_verified_source_set',zone:zoneInfo.zone,zoneSource:zoneInfo.source,imageTransport:'bright_data_native_file_upload'},diagnostics:d},{status:400,headers:{'cache-control':'no-store'}})}
    return Response.json(json,{status:res.status,headers:{'cache-control':'no-store'}})
  }
  if(String(json?.error||'').includes('Google Lens discovery failed for every product image'))return Response.json({error:`${json.error} Native file upload transport was active, so the failure is now inside Bright Data/Google Lens response handling rather than image URL reachability.`,brightData:{stage:'native_lens_response',zone:zoneInfo.zone,zoneSource:zoneInfo.source,activeSerpZones:zoneInfo.activeSerpZones,imageTransport:'bright_data_native_file_upload'},transportDiagnostics},{status:400,headers:{'cache-control':'no-store'}});
  return Response.json(json,{status:res.status,headers:{'cache-control':'no-store'}})
}

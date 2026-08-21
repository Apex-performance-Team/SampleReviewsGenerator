export const runtime='nodejs';
export const maxDuration=300;

import{withBrightLensNativeContext}from'../../../lib/bright-lens-native';

const BD='https://api.brightdata.com';
let cachedZone=null;

function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}

async function accountPreflight(key){
  if(!key)return{ok:false,configured:false,httpStatus:null,error:'Bright Data Lens is not configured.'};
  try{
    const r=await fetch(`${BD}/status`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(12000)}),raw=await r.text();
    if(!r.ok)return{ok:false,configured:true,httpStatus:r.status,error:`Bright Data account API ${r.status}: ${clean(raw).slice(0,180)}`};
    if(/invalid status|not active|inactive|suspended/i.test(raw))return{ok:false,configured:true,httpStatus:r.status,error:'Bright Data account is not active.'};
    return{ok:true,configured:true,httpStatus:r.status,error:null};
  }catch(e){return{ok:null,configured:true,httpStatus:null,error:`Bright Data account preflight failed: ${clean(e?.message||e).slice(0,180)}`}}
}

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

function emptyScanDiagnostic(rs,transport,providerPreflight){
  const l=rs?.lensDiscovery||{},v=rs?.verificationDiagnostics||{};
  return{providerPreflight,sourceImages:Array.isArray(l.sourceImages)?l.sourceImages.length:null,lensRequests:l.requests??l.lensRequests??null,lensRequestsSucceeded:l.succeeded??null,rawResults:l.rawResults??null,uniqueCandidates:l.uniqueCandidates??null,acceptedCandidates:l.acceptedCandidates??null,rejectedCandidates:l.rejectedCandidates??null,verifierCandidates:v.candidates??null,verifierAccepted:v.accepted??null,verifierRejected:v.rejected??null,amazonCandidates:l.amazonCandidates??null,amazonAccepted:l.amazonAccepted??null,amazonFallback:rs?.amazonFallbackDiscovery||null,tabs:l.tabs||null,transport:(transport||[]).slice(0,12)};
}

export async function POST(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'',providerPreflight=await accountPreflight(key);
  let body;try{body=await req.json()}catch{return Response.json({error:'Invalid JSON body.'},{status:400})}
  const originalProductUrl=String(body?.productUrl||'').trim();if(!originalProductUrl)return Response.json({error:'Product URL is required.'},{status:400});
  let zoneInfo={zone:clean(process.env.BRIGHT_DATA_SERP_ZONE)||null,source:'not_resolved',activeSerpZones:[]},lensUnavailableReason=null;
  if(providerPreflight.ok===false)lensUnavailableReason=providerPreflight.error;
  else if(key){try{zoneInfo=await resolveSerpZone(key);process.env.BRIGHT_DATA_SERP_ZONE=zoneInfo.zone}catch(e){lensUnavailableReason=e?.message||String(e)}}
  else lensUnavailableReason='Bright Data Lens is not configured.';
  const forwardedBody={...body,...(lensUnavailableReason?{_lensUnavailableReason:lensUnavailableReason}:{})},forwarded=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(forwardedBody)});
  const mod=await import('../reference-scan-v12/route.js');
  const transportDiagnostics=[];
  let res;
  try{
    res=lensUnavailableReason?await mod.POST(forwarded):await withBrightLensNativeContext({referer:originalProductUrl,diagnostics:transportDiagnostics},()=>mod.POST(forwarded));
  }catch(e){return Response.json({error:`Reference discovery failed: ${e?.message||String(e)}`,brightData:{stage:'discovery_exception',zone:zoneInfo.zone,zoneSource:zoneInfo.source,providerPreflight},transportDiagnostics},{status:400,headers:{'cache-control':'no-store'}})}
  let json;try{json=await res.clone().json()}catch{return res}
  if(res.ok&&json?.referenceSet){
    json.referenceSet.productUrl=originalProductUrl;
    json.referenceSet=stripOriginalStore(json.referenceSet,originalProductUrl);
    json.referenceSet.provenance={...(json.referenceSet.provenance||{}),imageTransport:lensUnavailableReason?'lens_skipped':'bright_data_native_file_upload',originalProductUrl,providerPreflight};
    json.referenceSet.lensDiscovery={...(json.referenceSet.lensDiscovery||{}),transport:lensUnavailableReason?'skipped_provider_unavailable':'native_file_upload'};
    if(!(json.referenceSet.sourceCounts||[]).length){const d=emptyScanDiagnostic(json.referenceSet,transportDiagnostics,providerPreflight),t=d.transport?.[0]||{},providerReason=lensUnavailableReason||t.error||d.amazonFallback?.diagnostics?.error||null;return Response.json({error:`Reference scan returned no verified external sources after Lens and Amazon fallback.${providerReason?` Provider diagnostic: ${providerReason}`:''}`,brightData:{stage:'empty_verified_source_set',zone:zoneInfo.zone,zoneSource:zoneInfo.source,imageTransport:lensUnavailableReason?'lens_skipped':'bright_data_native_file_upload',providerPreflight},diagnostics:d},{status:400,headers:{'cache-control':'no-store'}})}
    return Response.json(json,{status:res.status,headers:{'cache-control':'no-store'}})
  }
  return Response.json({...json,brightData:{...(json?.brightData||{}),providerPreflight,zone:zoneInfo.zone,zoneSource:zoneInfo.source}},{status:res.status,headers:{'cache-control':'no-store'}})
}

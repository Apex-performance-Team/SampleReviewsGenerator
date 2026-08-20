export const runtime='nodejs';
export const maxDuration=180;

import{createHmac}from'node:crypto';

const BD='https://api.brightdata.com';
const DEFAULT_TEST_IMAGE='https://www.youtube.com/img/desktop/yt_1200.png';
let cachedZone=null;

function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function sign(x,key){return createHmac('sha256',key).update(x).digest('hex')}

async function getActiveZones(key){
  const r=await fetch(`${BD}/zone/get_active_zones`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
  const raw=await r.text();
  if(!r.ok)throw Error(`Bright Data zone lookup HTTP ${r.status}: ${clean(raw).slice(0,220)}`);
  let zones;try{zones=JSON.parse(raw)}catch{throw Error('Bright Data zone lookup returned invalid JSON.')}
  if(!Array.isArray(zones))throw Error('Bright Data zone lookup returned an unexpected response.');
  return zones;
}

async function resolveSerpZone(key){
  if(cachedZone)return{zone:cachedZone,source:'cache',activeSerpZones:[cachedZone]};
  const configured=clean(process.env.BRIGHT_DATA_SERP_ZONE);
  const zones=await getActiveZones(key);
  const serp=zones.filter(z=>String(z?.type||'').toLowerCase()==='serp'&&z?.name);
  if(configured){const match=serp.find(z=>z.name===configured);if(match){cachedZone=match.name;return{zone:match.name,source:'environment',activeSerpZones:serp.map(z=>z.name)}}}
  if(!serp.length)throw Error('Bright Data API key is valid, but this account has no active SERP API zone. Create or activate a SERP API zone in Bright Data, then rescan.');
  cachedZone=serp[0].name;return{zone:serp[0].name,source:'auto_detected',activeSerpZones:serp.map(z=>z.name)};
}

async function brightConnectivityTest(key,zone){
  const q=`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(DEFAULT_TEST_IMAGE)}&brd_json=1&brd_lens=exact_matches&hl=en&gl=US`;
  const r=await fetch(`${BD}/request`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({zone,url:q,format:'raw'}),signal:AbortSignal.timeout(45000)}),raw=await r.text();
  return{ok:r.ok,status:r.status,detail:r.ok?'Bright Data Lens connectivity test succeeded.':clean(raw).slice(0,260)};
}

function recomputePlatformCounts(refs){const m=new Map();for(const r of refs||[]){const k=`${r.platform}|${r.provider||''}`,x=m.get(k)||{platform:r.platform,provider:r.provider,reviewCount:0,pages:new Set()};x.reviewCount++;x.pages.add(r.sourceUrl);m.set(k,x)}return[...m.values()].map(x=>({platform:x.platform,provider:x.provider,reviewCount:x.reviewCount,pageCount:x.pages.size})).sort((a,b)=>b.reviewCount-a.reviewCount)}
function stripOriginalStore(rs,originalProductUrl){const h=host(originalProductUrl);if(!h||!rs)return rs;rs.sourceCounts=(rs.sourceCounts||[]).filter(x=>host(x.directSourceUrl||x.sourceUrl)!==h);rs.aggregateOnlySources=(rs.aggregateOnlySources||[]).filter(x=>host(x.directSourceUrl||x.sourceUrl)!==h);rs.references=(rs.references||[]).filter(x=>host(x.sourceUrl)!==h);rs.platformCounts=recomputePlatformCounts(rs.references);rs.totalIndividualReviews=rs.references.length;rs.availableForGeneration=Math.min(250,rs.references.length);rs.matchedPages=rs.sourceCounts.length;rs.verifiedSourceLinks=rs.sourceCounts.filter(x=>x.linkVerified).length;return rs}

export async function POST(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'';if(!key)return Response.json({error:'Bright Data Lens is not configured.'},{status:400});
  let zoneInfo;try{zoneInfo=await resolveSerpZone(key)}catch(e){return Response.json({error:e?.message||String(e),brightData:{stage:'zone_discovery'}},{status:400,headers:{'cache-control':'no-store'}})}
  process.env.BRIGHT_DATA_SERP_ZONE=zoneInfo.zone;
  let body;try{body=await req.json()}catch{return Response.json({error:'Invalid JSON body.'},{status:400})}
  const originalProductUrl=String(body?.productUrl||'').trim();if(!originalProductUrl)return Response.json({error:'Product URL is required.'},{status:400});
  const origin=new URL(req.url).origin,staged=`${origin}/api/lens-pdp?u=${encodeURIComponent(originalProductUrl)}&s=${sign(originalProductUrl,key)}`;
  const forwarded=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify({...body,productUrl:staged})});
  const mod=await import('../reference-scan-v11/route.js');
  const res=await mod.POST(forwarded);
  let json;try{json=await res.clone().json()}catch{return res}
  if(res.ok&&json?.referenceSet){json.referenceSet.productUrl=originalProductUrl;json.referenceSet=stripOriginalStore(json.referenceSet,originalProductUrl);json.referenceSet.provenance={...(json.referenceSet.provenance||{}),imageTransport:'signed_vercel_relay',originalProductUrl,stagedProductUrl:staged};return Response.json(json,{status:res.status,headers:{'cache-control':'no-store'}})}
  if(String(json?.error||'').includes('Google Lens discovery failed for every product image')){
    const test=await brightConnectivityTest(key,zoneInfo.zone).catch(e=>({ok:false,status:null,detail:e?.message||String(e)}));
    const extra=test.ok?` Bright Data and zone "${zoneInfo.zone}" are reachable. The signed Vercel image relay is now enabled; if this still fails, the relay endpoint itself could not fetch the upstream product image.`:` Bright Data connectivity test failed on active SERP zone "${zoneInfo.zone}": ${test.detail}`;
    return Response.json({error:`${json.error}${extra}`,brightData:{stage:'lens_requests',zone:zoneInfo.zone,zoneSource:zoneInfo.source,activeSerpZones:zoneInfo.activeSerpZones,connectivityTest:test,imageTransport:'signed_vercel_relay',stagedProductUrl:staged}},{status:400,headers:{'cache-control':'no-store'}})
  }
  return Response.json(json,{status:res.status,headers:{'cache-control':'no-store'}})
}

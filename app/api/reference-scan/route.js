export const runtime='nodejs';
export const maxDuration=180;

const BD='https://api.brightdata.com';
const DEFAULT_TEST_IMAGE='https://www.youtube.com/img/desktop/yt_1200.png';
let cachedZone=null;

function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}

async function getActiveZones(key){
  const r=await fetch(`${BD}/zone/get_active_zones`,{headers:{authorization:`Bearer ${key}`},signal:AbortSignal.timeout(15000)});
  const raw=await r.text();
  if(!r.ok)throw Error(`Bright Data zone lookup HTTP ${r.status}: ${clean(raw).slice(0,220)}`);
  let zones;try{zones=JSON.parse(raw)}catch{throw Error('Bright Data zone lookup returned invalid JSON.')}
  if(!Array.isArray(zones))throw Error('Bright Data zone lookup returned an unexpected response.');
  return zones;
}

async function resolveSerpZone(key){
  if(cachedZone)return cachedZone;
  const configured=clean(process.env.BRIGHT_DATA_SERP_ZONE);
  const zones=await getActiveZones(key);
  const serp=zones.filter(z=>String(z?.type||'').toLowerCase()==='serp'&&z?.name);
  if(configured){
    const match=serp.find(z=>z.name===configured);
    if(match){cachedZone=match.name;return{zone:match.name,source:'environment',activeSerpZones:serp.map(z=>z.name)}}
  }
  if(!serp.length)throw Error('Bright Data API key is valid, but this account has no active SERP API zone. Create or activate a SERP API zone in Bright Data, then rescan.');
  cachedZone=serp[0].name;
  return{zone:serp[0].name,source:'auto_detected',activeSerpZones:serp.map(z=>z.name)};
}

async function brightConnectivityTest(key,zone){
  const q=`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(DEFAULT_TEST_IMAGE)}&brd_json=1&brd_lens=exact_matches&hl=en&gl=US`;
  const r=await fetch(`${BD}/request`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({zone,url:q,format:'raw'}),signal:AbortSignal.timeout(45000)});
  const raw=await r.text();
  return{ok:r.ok,status:r.status,detail:r.ok?'Bright Data Lens connectivity test succeeded.':clean(raw).slice(0,260)};
}

export async function POST(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'';
  if(!key)return Response.json({error:'Bright Data Lens is not configured.'},{status:400});
  let zoneInfo;
  try{zoneInfo=await resolveSerpZone(key)}catch(e){return Response.json({error:e?.message||String(e),brightData:{stage:'zone_discovery'}},{status:400,headers:{'cache-control':'no-store'}})}
  process.env.BRIGHT_DATA_SERP_ZONE=zoneInfo.zone;
  const raw=await req.text();
  const forwarded=new Request(req.url,{method:'POST',headers:req.headers,body:raw});
  const mod=await import('../reference-scan-v11/route.js');
  const res=await mod.POST(forwarded);
  if(res.ok)return res;
  let body;try{body=await res.clone().json()}catch{return res}
  if(String(body?.error||'').includes('Google Lens discovery failed for every product image')){
    const test=await brightConnectivityTest(key,zoneInfo.zone).catch(e=>({ok:false,status:null,detail:e?.message||String(e)}));
    const extra=test.ok
      ? ` Bright Data itself is reachable with active SERP zone "${zoneInfo.zone}"; the PDP image URLs sent to Lens were rejected or unreachable.`
      : ` Bright Data connectivity test failed on active SERP zone "${zoneInfo.zone}": ${test.detail}`;
    return Response.json({error:`${body.error}${extra}`,brightData:{stage:'lens_requests',zone:zoneInfo.zone,zoneSource:zoneInfo.source,activeSerpZones:zoneInfo.activeSerpZones,connectivityTest:test}},{status:400,headers:{'cache-control':'no-store'}});
  }
  return res;
}

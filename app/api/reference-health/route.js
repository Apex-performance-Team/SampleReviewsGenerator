export const runtime='nodejs';
import{hasAIProvider}from'../../../lib/gateway';
import{getBrightDataBalance,classifyBrightDataFailure,cleanBright}from'../../../lib/bright-data-status';

const BD='https://api.brightdata.com';
function parseStatus(text){
  try{
    const value=JSON.parse(text);
    return{
      parsed:true,
      status:value?.status??null,
      canMakeRequests:value?.can_make_requests??null,
      authFailReason:value?.auth_fail_reason??null
    };
  }catch{
    return{
      parsed:false,
      status:null,
      canMakeRequests:null,
      authFailReason:null
    };
  }
}
function statusHealthy(statusText,statusInfo){
  const status=String(statusInfo?.status||'').toLowerCase();
  const authFail=String(statusInfo?.authFailReason||'').toLowerCase();
  if(authFail==='zone_not_found'||/zone_not_found|zone not found/i.test(String(statusText||'')))return null;
  if(status&&status!=='active')return false;
  if(statusInfo?.canMakeRequests===false)return false;
  if(/invalid status|not active|inactive|suspended|kyc|required|forbidden|not authorized/.test(`${statusText} ${authFail}`.toLowerCase()))return false;
  return true;
}
async function brightDataHealth(key){
  if(!key)return{configured:false,healthy:false,httpStatus:null,error:'not_configured',zones:[],balance:null,pendingBalance:null,noCredits:false,statusInfo:null};
  const balance=await getBrightDataBalance(key,{force:true});
  if(balance.noCredits)return{configured:true,healthy:false,httpStatus:402,error:'bright_data_no_credits',zones:[],balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:true,statusInfo:null};
  let status=null,statusText='',statusInfo=null,zones=[];
  try{const r=await fetch(`${BD}/status`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(10000)});status=r.status;statusText=await r.text();statusInfo=parseStatus(statusText);if(!r.ok){const f=classifyBrightDataFailure({status:r.status,body:statusText,headers:r.headers,service:'account'});return{configured:true,healthy:false,httpStatus:r.status,error:f?.code||cleanBright(statusText).slice(0,180),zones:[],balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:f?.code==='bright_data_no_credits',statusInfo}}}catch(e){return{configured:true,healthy:null,httpStatus:null,error:cleanBright(e?.message||e).slice(0,180),zones:[],balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:false,statusInfo:null}}
  try{const r=await fetch(`${BD}/zone/get_active_zones`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(10000)}),raw=await r.text();if(r.ok){const j=JSON.parse(raw);if(Array.isArray(j))zones=j.filter(x=>String(x?.type||'').toLowerCase()==='serp'&&x?.name).map(x=>x.name)}}catch{}
  const configuredZone=String(process.env.BRIGHT_DATA_SERP_ZONE||'').trim(),resolvedZone=configuredZone&&zones.includes(configuredZone)?configuredZone:zones[0]||null,statusOk=statusHealthy(statusText,statusInfo),zoneOk=Boolean(resolvedZone);
  return{configured:true,healthy:statusOk===false?false:zoneOk,httpStatus:status,error:null,zones,balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:false,statusInfo,configuredZone,activeSerpZone:resolvedZone,statusRequiresZoneResolution:statusOk===null};
}

export async function GET(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'',brightData=await brightDataHealth(key),verifierConfigured=hasAIProvider(req);
  const credentialsConfigured=brightData.configured&&verifierConfigured,primaryOperational=brightData.healthy===true&&verifierConfigured;
  // Reference discovery now has credential-free/public search plus deterministic image verification fallbacks.
  // Keep `configured` true so the browser actually attempts a scan even when paid providers are degraded.
  const fallbackDiscoveryAvailable=true,canAttemptReferenceSourcing=primaryOperational||fallbackDiscoveryAvailable,degraded=!primaryOperational;
  const reason=!brightData.configured?'Bright Data is not configured; fallback discovery is available.':brightData.noCredits?'Bright Data has no available credits/balance; fallback discovery is available, but high-volume review collection will remain unavailable until funds are added.':brightData.healthy!==true?`${brightData.error||'Bright Data account is not operational.'} Fallback discovery is available.`:!verifierConfigured?'No AI verification provider is configured; deterministic image verification is available.':null;
  return Response.json({ok:canAttemptReferenceSourcing,provider:primaryOperational?'Bright Data Google Lens + AI same-product verification':'Degraded reference discovery with deterministic/public fallbacks',configured:canAttemptReferenceSourcing,credentialsConfigured,healthy:primaryOperational,degraded,canAttemptReferenceSourcing,fallbackDiscoveryAvailable,reason,lensConfigured:brightData.configured,lensHealthy:brightData.healthy,brightDataHttpStatus:brightData.httpStatus,brightDataStatus:brightData.statusInfo?.status??null,brightDataCanMakeRequests:brightData.statusInfo?.canMakeRequests??null,brightDataAuthFailReason:brightData.statusInfo?.authFailReason??null,brightDataStatusRequiresZoneResolution:brightData.statusRequiresZoneResolution??false,brightDataConfiguredSerpZone:brightData.configuredZone||null,brightDataActiveSerpZone:brightData.activeSerpZone||null,brightDataActiveSerpZoneCount:Array.isArray(brightData.zones)?brightData.zones.length:0,brightDataNoCredits:brightData.noCredits,brightDataBalanceKeyConfigured:Boolean(process.env.BRIGHT_DATA_BALANCE_API_KEY),verifierConfigured},{status:200,headers:{'cache-control':'no-store'}})
}

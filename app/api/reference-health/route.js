export const runtime='nodejs';
import{hasAIProvider,authMode,directOpenAIToken}from'../../../lib/gateway';
import{getBrightDataBalance,classifyBrightDataFailure,cleanBright}from'../../../lib/bright-data-status';

const BD='https://api.brightdata.com';
async function brightDataHealth(key){
  if(!key)return{configured:false,healthy:false,httpStatus:null,error:'not_configured',zones:[],balance:null,pendingBalance:null,noCredits:false};
  const balance=await getBrightDataBalance(key,{force:true});
  if(balance.noCredits)return{configured:true,healthy:false,httpStatus:402,error:'bright_data_no_credits',zones:[],balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:true};
  let status=null,statusText='',zones=[];
  try{const r=await fetch(`${BD}/status`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(10000)});status=r.status;statusText=await r.text();if(!r.ok){const f=classifyBrightDataFailure({status:r.status,body:statusText,headers:r.headers,service:'account'});return{configured:true,healthy:false,httpStatus:r.status,error:f?.code||cleanBright(statusText).slice(0,180),zones:[],balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:f?.code==='bright_data_no_credits'}}}catch(e){return{configured:true,healthy:null,httpStatus:null,error:cleanBright(e?.message||e).slice(0,180),zones:[],balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:false}}
  try{const r=await fetch(`${BD}/zone/get_active_zones`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(10000)}),raw=await r.text();if(r.ok){const j=JSON.parse(raw);if(Array.isArray(j))zones=j.filter(x=>String(x?.type||'').toLowerCase()==='serp'&&x?.name).map(x=>x.name)}}catch{}
  return{configured:true,healthy:!/invalid status|not active|inactive|suspended/i.test(statusText),httpStatus:status,error:null,zones,balance:balance.balance,pendingBalance:balance.pendingBalance,noCredits:false};
}

export async function GET(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'',brightData=await brightDataHealth(key),verifierConfigured=hasAIProvider(req),directOpenAIConfigured=Boolean(directOpenAIToken());
  const credentialsConfigured=brightData.configured&&verifierConfigured,operational=brightData.healthy===true&&verifierConfigured;
  const reason=!brightData.configured?'Bright Data is not configured.':brightData.noCredits?'Bright Data has no available credits/balance. Add funds in Bright Data, then rescan.':brightData.healthy!==true?(brightData.error||'Bright Data account is not operational.') :!verifierConfigured?'No AI verification provider is configured.':null;
  return Response.json({ok:operational,provider:'Bright Data Google Lens + AI same-product verification',configured:operational,credentialsConfigured,healthy:operational,reason,lensConfigured:brightData.configured,lensHealthy:brightData.healthy,brightDataHttpStatus:brightData.httpStatus,brightDataError:brightData.error,brightDataNoCredits:brightData.noCredits,brightDataBalance:brightData.balance,brightDataPendingBalance:brightData.pendingBalance,activeSerpZones:brightData.zones,verifierConfigured,verifierAuth:authMode(req),directOpenAIConfigured,zone:brightData.zones[0]||process.env.BRIGHT_DATA_SERP_ZONE||null,env:null},{status:operational?200:brightData.noCredits?402:503,headers:{'cache-control':'no-store'}})
}

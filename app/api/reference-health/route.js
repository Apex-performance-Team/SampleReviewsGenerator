export const runtime='nodejs';
import{hasAIProvider,authMode,directOpenAIToken}from'../../../lib/gateway';

const BD='https://api.brightdata.com';
const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
async function brightDataHealth(key){
  if(!key)return{configured:false,healthy:false,httpStatus:null,error:'not_configured',zones:[]};
  let status=null,statusText='',zones=[];
  try{const r=await fetch(`${BD}/status`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(10000)});status=r.status;statusText=await r.text();if(!r.ok)return{configured:true,healthy:false,httpStatus:r.status,error:clean(statusText).slice(0,180),zones:[]}}catch(e){return{configured:true,healthy:null,httpStatus:null,error:clean(e?.message||e).slice(0,180),zones:[]}}
  try{const r=await fetch(`${BD}/zone/get_active_zones`,{headers:{authorization:`Bearer ${key}`},cache:'no-store',signal:AbortSignal.timeout(10000)}),raw=await r.text();if(r.ok){const j=JSON.parse(raw);if(Array.isArray(j))zones=j.filter(x=>String(x?.type||'').toLowerCase()==='serp'&&x?.name).map(x=>x.name)}}catch{}
  return{configured:true,healthy:!/invalid status|not active|inactive|suspended/i.test(statusText),httpStatus:status,error:null,zones};
}

export async function GET(req){
  const key=process.env.BRIGHT_DATA_API_KEY||'',brightData=await brightDataHealth(key),verifierConfigured=hasAIProvider(req),directOpenAIConfigured=Boolean(directOpenAIToken());
  const configured=brightData.configured&&verifierConfigured,healthy=brightData.healthy===true&&verifierConfigured;
  return Response.json({ok:healthy,provider:'Bright Data Google Lens + AI same-product verification',configured,healthy,lensConfigured:brightData.configured,lensHealthy:brightData.healthy,brightDataHttpStatus:brightData.httpStatus,brightDataError:brightData.error,activeSerpZones:brightData.zones,verifierConfigured,verifierAuth:authMode(req),directOpenAIConfigured,zone:brightData.zones[0]||process.env.BRIGHT_DATA_SERP_ZONE||null,env:null},{status:healthy?200:503,headers:{'cache-control':'no-store'}})
}

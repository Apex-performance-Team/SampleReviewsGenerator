export const runtime='nodejs';
import{gatewayToken,authMode}from'../../../lib/gateway';
import{getBrightDataBalance}from'../../../lib/bright-data-status';

const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
function finiteNumber(v){if(v===null||v===undefined||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function findBalance(j){
  const direct=[j?.balance,j?.credits,j?.remaining,j?.available,j?.credit_balance,j?.credits_remaining,j?.data?.balance,j?.data?.credits,j?.data?.remaining,j?.data?.available];
  for(const v of direct){const n=finiteNumber(v);if(n!==null)return n}
  return null;
}
async function vercelCredits(req){
  const token=gatewayToken(req),mode=authMode(req);
  if(!token)return{configured:false,ok:false,balance:null,error:'No Vercel AI Gateway credential available.',authMode:mode};
  let r,raw;
  try{r=await fetch('https://ai-gateway.vercel.sh/v1/credits',{headers:{authorization:`Bearer ${token}`,accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000)});raw=await r.text()}catch(e){return{configured:true,ok:null,balance:null,error:`credit_fetch:${clean(e?.message||e)}`,authMode:mode}}
  let j=null;try{j=JSON.parse(raw)}catch{}
  if(!r.ok)return{configured:true,ok:false,balance:null,httpStatus:r.status,error:clean(j?.error?.message||j?.message||raw).slice(0,220),authMode:mode};
  return{configured:true,ok:true,balance:findBalance(j),httpStatus:r.status,error:null,authMode:mode};
}
export async function GET(req){
  const balanceKey=process.env.BRIGHT_DATA_BALANCE_API_KEY||process.env.BRIGHT_DATA_API_KEY||'';
  const balanceKeyMode=process.env.BRIGHT_DATA_BALANCE_API_KEY?'finance-key':'scraping-key';
  const [vercel,brightData]=await Promise.all([
    vercelCredits(req),
    getBrightDataBalance(balanceKey,{force:true})
  ]);
  return Response.json({
    ok:true,
    checkedAt:new Date().toISOString(),
    vercel:{provider:'Vercel AI Gateway',...vercel},
    brightData:{
      provider:'Bright Data',
      configured:brightData.configured,
      ok:brightData.ok,
      balance:brightData.balance,
      pendingBalance:brightData.pendingBalance,
      noCredits:brightData.noCredits,
      permissionRequired:Boolean(brightData.permissionRequired),
      errorCode:brightData.errorCode||null,
      error:brightData.error||null,
      balanceKeyMode,
      dedicatedBalanceKeyConfigured:Boolean(process.env.BRIGHT_DATA_BALANCE_API_KEY),
      permissionsUrl:'https://brightdata.com/cp/setting/users'
    }
  },{headers:{'cache-control':'no-store'}})
}

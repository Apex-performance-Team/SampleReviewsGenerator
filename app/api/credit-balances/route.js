export const runtime='nodejs';

import{createHash,createHmac,timingSafeEqual}from'node:crypto';
import{gatewayToken}from'../../../lib/gateway';
import{getBrightDataBalance}from'../../../lib/bright-data-status';

const COOKIE='synthetic_review_credit_session';
const SESSION_SECONDS=60*60*8;
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
const headers=extra=>({'cache-control':'private, no-store, max-age=0','pragma':'no-cache','vary':'Cookie',...extra});
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:headers(extra)});

function accessSecret(){return String(process.env.CREDIT_COUNTER_ACCESS_KEY||'')}
function hash(value){return createHash('sha256').update(String(value||'')).digest()}
function safeEqual(a,b){return timingSafeEqual(hash(a),hash(b))}
function sessionValue(secret){return createHmac('sha256',secret).update('synthetic-review-lab-credit-counter-v1').digest('hex')}
function cookieValue(req){
  const raw=String(req?.headers?.get?.('cookie')||'');
  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    if(part.slice(0,i).trim()===COOKIE)return part.slice(i+1).trim();
  }
  return'';
}
function isAuthorized(req,secret){const value=cookieValue(req);return Boolean(value&&safeEqual(value,sessionValue(secret)))}
function finiteNumber(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function findBalance(value){
  const direct=[value?.balance,value?.credits,value?.remaining,value?.available,value?.credit_balance,value?.credits_remaining,value?.data?.balance,value?.data?.credits,value?.data?.remaining,value?.data?.available];
  for(const candidate of direct){const n=finiteNumber(candidate);if(n!==null)return n}
  return null;
}
async function vercelCredits(req){
  const token=gatewayToken(req);
  if(!token)return{provider:'Vercel AI Gateway',configured:false,ok:false,balance:null,error:'AI Gateway credentials are not configured.'};
  let response,raw;
  try{
    response=await fetch('https://ai-gateway.vercel.sh/v1/credits',{headers:{authorization:`Bearer ${token}`,accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000)});
    raw=await response.text();
  }catch(error){return{provider:'Vercel AI Gateway',configured:true,ok:null,balance:null,error:`Credit check failed: ${clean(error?.message||error)}`}}
  let value=null;try{value=JSON.parse(raw)}catch{}
  if(!response.ok)return{provider:'Vercel AI Gateway',configured:true,ok:false,balance:null,error:clean(value?.error?.message||value?.message||raw).slice(0,180)};
  return{provider:'Vercel AI Gateway',configured:true,ok:true,balance:findBalance(value),error:null};
}
async function balances(req){
  const brightKey=process.env.BRIGHT_DATA_BALANCE_API_KEY||process.env.BRIGHT_DATA_API_KEY||'';
  const [vercel,bright]=await Promise.all([vercelCredits(req),getBrightDataBalance(brightKey,{force:true})]);
  return{
    ok:true,
    locked:false,
    checkedAt:new Date().toISOString(),
    currency:'USD',
    refreshSeconds:60,
    vercel,
    brightData:{
      provider:'Bright Data',
      configured:bright.configured,
      ok:bright.ok,
      balance:bright.balance,
      pendingBalance:bright.pendingBalance,
      noCredits:bright.noCredits,
      permissionRequired:Boolean(bright.permissionRequired),
      error:bright.error||null
    }
  };
}

export async function GET(req){
  const secret=accessSecret();
  if(secret.length<16)return json({ok:false,locked:true,configured:false,error:'Credit monitor access is not configured.'},503);
  if(!isAuthorized(req,secret))return json({ok:false,locked:true,configured:true},401);
  return json(await balances(req));
}

export async function POST(req){
  const secret=accessSecret();
  if(secret.length<16)return json({ok:false,locked:true,configured:false,error:'Credit monitor access is not configured.'},503);
  let body={};try{body=await req.json()}catch{}
  if(!safeEqual(body?.accessKey,secret))return json({ok:false,locked:true,error:'Invalid access key.'},401);
  const cookie=`${COOKIE}=${sessionValue(secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
  return json(await balances(req),200,{'set-cookie':cookie});
}

export async function DELETE(){
  return json({ok:true,locked:true},200,{'set-cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`});
}

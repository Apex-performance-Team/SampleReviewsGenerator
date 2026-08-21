const API='https://api.brightdata.com';
const cache={at:0,keyPrefix:'',value:null};
export const cleanBright=x=>String(x??'').replace(/\s+/g,' ').trim();

export function classifyBrightDataFailure({status=null,body='',headers=null,service='api'}={}){
  const text=cleanBright(body);
  let headerText='';
  try{const h=new Headers(headers||{});headerText=cleanBright([h.get('x-brd-error'),h.get('x-brd-err-msg'),h.get('x-brd-err-code')].filter(Boolean).join(' | '))}catch{}
  const hay=`${text} ${headerText}`.toLowerCase();
  const explicitCredits=/insufficient[_\s-]*(?:credits?|balance)|current balance is insufficient|add funds|top up|negative balance|account is suspended|account suspended|not enough (?:credits?|balance)|balance[^.]{0,40}(?:missing|insufficient)|\$\s*[0-9.,]+\s+is missing/.test(hay);
  const codeCredits=/insufficient_credits|payment_required/.test(hay);
  const dataset402=Number(status)===402&&service==='dataset'&&!/bad_endpoint|robots\.txt|immediate access|policy_2013|policy_2014/.test(hay);
  const noCredits=explicitCredits||codeCredits||dataset402;
  if(noCredits)return{kind:'no_credits',code:'bright_data_no_credits',retryable:false,message:'Bright Data has insufficient credits/balance. Add funds in Bright Data, then rescan.',status:Number(status)||null,raw:text.slice(0,320)};
  if(Number(status)===401||/unauthorized|invalid api key|invalid_api_key|authentication failed/.test(hay))return{kind:'auth',code:'bright_data_auth_failed',retryable:false,message:'Bright Data API key is invalid or unauthorized.',status:Number(status)||null,raw:text.slice(0,320)};
  if(Number(status)===429||/too many running jobs|maximum limit.+jobs|rate.?limit/.test(hay))return{kind:'rate_limit',code:'bright_data_rate_limited',retryable:true,message:'Bright Data is temporarily rate-limited or has too many running jobs. Retry shortly.',status:Number(status)||null,raw:text.slice(0,320)};
  if(/account is suspended|account suspended/.test(hay))return{kind:'suspended',code:'bright_data_account_suspended',retryable:false,message:'Bright Data account is suspended. Check billing/account status before rescanning.',status:Number(status)||null,raw:text.slice(0,320)};
  return null;
}

export function brightDataError(prefix,failure,fallback=''){
  if(failure?.code==='bright_data_no_credits')return`${prefix}:bright_data_no_credits:${failure.message}`;
  if(failure?.code)return`${prefix}:${failure.code}:${failure.message}`;
  return`${prefix}:${cleanBright(fallback).slice(0,300)}`;
}

export async function getBrightDataBalance(key,{force=false}={}){
  const token=String(key||'');
  if(!token)return{configured:false,ok:false,error:'api_key_missing',balance:null,pendingBalance:null,noCredits:false};
  const prefix=token.slice(0,8);
  if(!force&&cache.value&&cache.keyPrefix===prefix&&Date.now()-cache.at<30000)return cache.value;
  let r,raw;
  try{r=await fetch(`${API}/customer/balance`,{headers:{authorization:`Bearer ${token}`,'accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000)});raw=await r.text()}catch(e){const value={configured:true,ok:null,error:`balance_fetch:${cleanBright(e?.message||e)}`,balance:null,pendingBalance:null,noCredits:false};cache.at=Date.now();cache.keyPrefix=prefix;cache.value=value;return value}
  const failure=classifyBrightDataFailure({status:r.status,body:raw,headers:r.headers,service:'account'});
  if(!r.ok){const value={configured:true,ok:false,error:failure?.code||`balance_http_${r.status}:${cleanBright(raw).slice(0,180)}`,balance:null,pendingBalance:null,noCredits:failure?.code==='bright_data_no_credits',failure};cache.at=Date.now();cache.keyPrefix=prefix;cache.value=value;return value}
  let j;try{j=JSON.parse(raw)}catch{j={}}
  const balance=Number(j?.balance),pendingBalance=Number(j?.pending_balance),finite=Number.isFinite(balance);
  const noCredits=finite&&balance<=0;
  const value={configured:true,ok:true,error:null,balance:finite?balance:null,pendingBalance:Number.isFinite(pendingBalance)?pendingBalance:null,noCredits,failure:noCredits?{kind:'no_credits',code:'bright_data_no_credits',retryable:false,message:'Bright Data balance is empty or negative. Add funds in Bright Data, then rescan.',status:200,raw:''}:null};
  cache.at=Date.now();cache.keyPrefix=prefix;cache.value=value;return value;
}

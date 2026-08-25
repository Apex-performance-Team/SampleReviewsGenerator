import{createHash,createHmac,timingSafeEqual}from'node:crypto';

const COOKIE='synthetic_review_run_session';
const SESSION_SECONDS=60*60*8;

function accessSecret(){return String(process.env.RUNS_ACCESS_KEY||process.env.CREDIT_COUNTER_ACCESS_KEY||'')}
function hash(value){return createHash('sha256').update(String(value||'')).digest()}
function safeEqual(a,b){return timingSafeEqual(hash(a),hash(b))}
function sessionValue(secret){return createHmac('sha256',secret).update('synthetic-review-lab-runs-v1').digest('hex')}
function cookieValue(req){
  const raw=String(req?.headers?.get?.('cookie')||'');
  for(const part of raw.split(';')){
    const i=part.indexOf('=');
    if(i<0)continue;
    if(part.slice(0,i).trim()===COOKIE)return part.slice(i+1).trim();
  }
  return'';
}
function headers(extra={}){return{'cache-control':'private, no-store, max-age=0','pragma':'no-cache','vary':'Cookie',...extra}}
export function runAccessHeaders(extra={}){return headers(extra)}
export function hasRunAccess(req){
  const secret=accessSecret();
  if(secret.length<16)return false;
  const cookie=cookieValue(req),header=String(req?.headers?.get?.('x-review-run-access-key')||'');
  return Boolean((cookie&&safeEqual(cookie,sessionValue(secret)))||(header&&safeEqual(header,secret)));
}
export function runAccessDenied(req){
  const secret=accessSecret();
  if(secret.length<16)return Response.json({ok:false,locked:true,configured:false,error:'Server run access is not configured.'},{status:503,headers:headers()});
  if(!hasRunAccess(req))return Response.json({ok:false,locked:true,configured:true},{status:401,headers:headers()});
  return null;
}
export async function unlockRunAccess(req){
  const secret=accessSecret();
  if(secret.length<16)return Response.json({ok:false,locked:true,configured:false,error:'Server run access is not configured.'},{status:503,headers:headers()});
  let body={};try{body=await req.json()}catch{}
  if(!safeEqual(body?.accessKey,secret))return Response.json({ok:false,locked:true,error:'Invalid access key.'},{status:401,headers:headers()});
  return Response.json({ok:true,locked:false},{headers:headers({'set-cookie':`${COOKIE}=${sessionValue(secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`})});
}
export function lockRunAccess(){
  return Response.json({ok:true,locked:true},{headers:headers({'set-cookie':`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`})});
}

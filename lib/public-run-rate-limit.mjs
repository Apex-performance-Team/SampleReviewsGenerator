const DEFAULT_WINDOW_MS=15*60*1000;
const buckets=globalThis.__syntheticReviewRunPublicRateBuckets||new Map();
globalThis.__syntheticReviewRunPublicRateBuckets=buckets;

function header(req,name){return String(req?.headers?.get?.(name)||'').trim()}
function clientIp(req){
  const forwarded=header(req,'x-forwarded-for').split(',').map(x=>x.trim()).filter(Boolean)[0];
  return forwarded||header(req,'x-real-ip')||header(req,'cf-connecting-ip')||'unknown';
}
function cleanup(now){
  if(buckets.size<500)return;
  for(const[key,bucket]of buckets)if(bucket.resetAt<=now)buckets.delete(key);
}

export function publicRunRateLimit(req,{label='review-runs',limit=120,windowMs=DEFAULT_WINDOW_MS}={}){
  const now=Date.now(),safeLimit=Math.max(1,Math.floor(Number(limit)||1)),safeWindow=Math.max(1000,Math.floor(Number(windowMs)||DEFAULT_WINDOW_MS));
  cleanup(now);
  const key=`${label}:${clientIp(req)}`,current=buckets.get(key);
  const bucket=!current||current.resetAt<=now?{count:0,resetAt:now+safeWindow}:current;
  bucket.count++;
  buckets.set(key,bucket);
  if(bucket.count<=safeLimit)return null;
  const retryAfter=Math.max(1,Math.ceil((bucket.resetAt-now)/1000));
  return Response.json({error:'Public run rate limit reached. Try again shortly.',retryAfterSeconds:retryAfter},{status:429,headers:{'cache-control':'no-store','retry-after':String(retryAfter)}});
}

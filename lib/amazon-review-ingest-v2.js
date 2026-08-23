import{classifyBrightDataFailure,brightDataError}from'./bright-data-status';

const DATASET='gd_le8e811kzy4ggddlq';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=x=>String(x??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();

export function amazonAsinV2(raw){
  const s=String(raw||'');
  const explicit=s.match(/\/(?:dp|gp\/product|product-reviews|clp)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1];
  if(explicit)return explicit.toUpperCase();
  const any=s.match(/(?:^|[^A-Z0-9])([A-Z0-9]{10})(?:[^A-Z0-9]|$)/i)?.[1];
  return any&&/^B[A-Z0-9]{9}$/i.test(any)?any.toUpperCase():null;
}
export function isAmazonV2(raw){try{return /(^|\.)amazon\./i.test(new URL(String(raw||'')).hostname)}catch{return false}}
function canonicalAmazon(raw){const asin=amazonAsinV2(raw);return asin?`https://www.amazon.com/dp/${asin}`:String(raw||'')}
function rating(v){const n=Number(String(v??'').match(/([1-5](?:\.\d)?)/)?.[1]);return n>=1&&n<=5?n:null}
function reviewId(x){
  const direct=clean(x?.review_id||x?.reviewId||x?.review_identifier||x?.reviewIdentifier||x?.id||'');
  if(direct)return direct;
  for(const v of [x?.review_url,x?.reviewUrl,x?.url_review,x?.permalink]){const m=String(v||'').match(/(?:customer-reviews\/|\/review\/)(R[A-Z0-9]+)/i);if(m)return m[1].toUpperCase()}
  return'';
}
function rowsFrom(data){return Array.isArray(data)?data:Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[data]}
function parse(data){
  const rows=rowsFrom(data),reviews=[];let aggregateRatingCount=null,aggregateRating=null;
  for(const x of rows){
    if(!x||typeof x!=='object')continue;
    const c=Number(String(x.product_rating_count??'').replace(/[^0-9.]/g,''));if(Number.isFinite(c)&&c>=0)aggregateRatingCount=aggregateRatingCount==null?c:Math.max(aggregateRatingCount,c);
    const ar=Number(x.product_rating);if(Number.isFinite(ar)&&ar>0)aggregateRating=ar;
    const body=clean(x.review_text||x.text||x.review_body||x.body||'');if(!body)continue;
    reviews.push({body,title:clean(x.review_header||x.review_title||x.title||'').slice(0,220),rating:rating(x.rating),reviewId:reviewId(x),verifiedPurchase:Boolean(x.is_verified??x.verified_purchase),reviewDate:x.review_posted_date||x.review_date||x.date||null,authorName:clean(x.author_name||x.reviewer_name||'')});
  }
  const first=rows.find(x=>x&&typeof x==='object')||{};
  return{rows,reviews,keys:Object.keys(first).slice(0,80),aggregateRatingCount,aggregateRating};
}
function bodyKey(s){return clean(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function dedupe(reviews,max){const out=[],seen=new Set();for(const r of reviews){const k=bodyKey(r.body);if(!k||seen.has(k))continue;seen.add(k);out.push(r);if(out.length>=max)break}return out}
async function snapshot(input,{polls=150}={}){
  const key=process.env.BRIGHT_DATA_API_KEY||'';if(!key)return{ok:false,error:'api_key_missing'};
  let tr,txt;try{tr=await fetch(`https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET}&format=json&uncompressed_webhook=true`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','accept':'application/json'},body:JSON.stringify([input]),cache:'no-store',signal:AbortSignal.timeout(15000)});txt=await tr.text()}catch(e){return{ok:false,error:`trigger:${clean(e?.message||e)}`}}
  if(!tr.ok){const f=classifyBrightDataFailure({status:tr.status,body:txt,headers:tr.headers,service:'dataset'});return{ok:false,httpStatus:tr.status,noCredits:f?.code==='bright_data_no_credits',error:f?brightDataError('trigger',f,txt):`trigger_http_${tr.status}:${clean(txt).slice(0,220)}`}}
  let j;try{j=JSON.parse(txt)}catch{return{ok:false,error:`trigger_json:${clean(txt).slice(0,220)}`}}
  const id=String(j?.snapshot_id||j?.id||'');if(!id)return{ok:false,error:`missing_snapshot:${clean(txt).slice(0,220)}`};
  let status='starting';for(let i=0;i<polls;i++){await sleep(i?1500:700);try{const r=await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${key}`,'accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(8000)}),t=await r.text();if(!r.ok){const f=classifyBrightDataFailure({status:r.status,body:t,headers:r.headers,service:'dataset'});if(f?.code==='bright_data_no_credits')return{ok:false,snapshotId:id,httpStatus:r.status,noCredits:true,error:brightDataError('progress',f,t)};continue}const p=JSON.parse(t);status=String(p?.status||status).toLowerCase();if(status==='ready')break;if(status==='failed'){const msg=clean(p?.error||p?.message||'failed'),f=classifyBrightDataFailure({body:msg,service:'dataset'});return{ok:false,snapshotId:id,noCredits:f?.code==='bright_data_no_credits',error:f?brightDataError('snapshot',f,msg):`snapshot_failed:${msg}`}}}catch{}}
  if(status!=='ready')return{ok:false,pending:true,snapshotId:id,error:`snapshot_${status}`};
  let sr,raw;try{sr=await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(id)}?format=json`,{headers:{authorization:`Bearer ${key}`,'accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});raw=await sr.text()}catch(e){return{ok:false,snapshotId:id,error:`download:${clean(e?.message||e)}`}}
  if(!sr.ok){const f=classifyBrightDataFailure({status:sr.status,body:raw,headers:sr.headers,service:'dataset'});return{ok:false,snapshotId:id,httpStatus:sr.status,noCredits:f?.code==='bright_data_no_credits',error:f?brightDataError('download',f,raw):`download_http_${sr.status}:${clean(raw).slice(0,220)}`}}
  let data;try{data=JSON.parse(raw)}catch{return{ok:false,snapshotId:id,error:`download_json:${clean(raw).slice(0,220)}`}}return{ok:true,snapshotId:id,data};
}

export async function collectAmazonReviewsV2(source,{maxReviews=200,maxBatches=4}={}){
  const started=Date.now(),sourceUrl=source?.directSourceUrl||source?.sourceUrl||'';
  const asin=source?.asin||amazonAsinV2(sourceUrl),url=asin?`https://www.amazon.com/dp/${asin}`:canonicalAmazon(sourceUrl);
  if(!asin)return{reviews:[],provider:'bright_data_amazon_reviews_v2',attempted:0,failed:1,blocked:0,error:'missing_asin',canonicalUrl:url};
  const requested=Math.max(1,Math.min(Number(maxReviews)||200,250)),batchLimit=Math.max(1,Math.min(Number(maxBatches)||4,8)),perBatchReviews=Math.min(50,requested);
  const all=[],excludeIds=[],seenIds=new Set(),seenBodies=new Set(),batches=[];let pending=false,failed=0,lastError='',aggregateRatingCount=null,aggregateRating=null,noCredits=false,httpStatus=null;
  for(let batch=1;batch<=batchLimit&&all.length<requested;batch++){
    const remaining=requested-all.length,batchReviews=Math.min(perBatchReviews,remaining);
    const job=await snapshot({url,reviews_to_not_include:[...excludeIds],max_reviews:batchReviews,variation_specific:false});
    if(!job.ok){pending=Boolean(job.pending);noCredits=Boolean(job.noCredits);httpStatus=job.httpStatus||null;failed=job.pending?0:1;lastError=job.error?.includes('bright_data_no_credits')?job.error:`bright_data_${job.error}`;batches.push({batch,ok:false,pending:Boolean(job.pending),noCredits,snapshotId:job.snapshotId||null,error:lastError});break}
    const parsed=parse(job.data),newIds=[];let newBodies=0;
    if(parsed.aggregateRatingCount!=null)aggregateRatingCount=aggregateRatingCount==null?parsed.aggregateRatingCount:Math.max(aggregateRatingCount,parsed.aggregateRatingCount);
    if(parsed.aggregateRating!=null)aggregateRating=parsed.aggregateRating;
    for(const r of parsed.reviews){
      const id=clean(r.reviewId);if(id&&!seenIds.has(id)){seenIds.add(id);excludeIds.push(id);newIds.push(id)}
      const key=bodyKey(r.body);if(!key||seenBodies.has(key))continue;seenBodies.add(key);all.push(r);newBodies++;if(all.length>=requested)break;
    }
    batches.push({batch,ok:true,snapshotId:job.snapshotId,requested:batchReviews,rawRows:parsed.rows.length,parsedBodies:parsed.reviews.length,newBodies,newReviewIds:newIds.length,totalBodies:all.length,totalReviewIds:excludeIds.length,aggregateRatingCount:parsed.aggregateRatingCount,aggregateRating:parsed.aggregateRating,rowKeys:parsed.keys});
    if(newBodies===0||newIds.length===0)break;
  }
  const reviews=dedupe(all,requested);
  return{reviews,provider:'bright_data_amazon_reviews_v2',attempted:batches.length,failed,blocked:0,pending,noCredits,httpStatus,canonicalUrl:url,requested,perBatchReviews,rawRows:batches.reduce((n,b)=>n+(b.rawRows||0),0),parsedBodies:batches.reduce((n,b)=>n+(b.parsedBodies||0),0),reviewIdCount:excludeIds.length,reviewIds:excludeIds.slice(0,250),rowKeys:batches.find(b=>b.rowKeys)?.rowKeys||[],aggregateRatingCount,aggregateRating,batches,elapsedMs:Date.now()-started,error:reviews.length?'':(lastError||'bright_data_amazon_zero_reviews')};
}

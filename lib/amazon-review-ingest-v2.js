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
  const rows=rowsFrom(data),reviews=[];
  for(const x of rows){
    if(!x||typeof x!=='object')continue;
    const body=clean(x.review_text||x.text||x.review_body||x.body||'');if(body.length<10)continue;
    reviews.push({body,title:clean(x.review_title||x.title||'').slice(0,220),rating:rating(x.rating),reviewId:reviewId(x),verifiedPurchase:Boolean(x.verified_purchase),reviewDate:x.review_posted_date||x.review_date||x.date||null,authorName:clean(x.author_name||x.reviewer_name||'')});
  }
  const first=rows.find(x=>x&&typeof x==='object')||{};
  return{rows,reviews,keys:Object.keys(first).slice(0,80)};
}
function dedupe(reviews,max){const out=[],seen=new Set();for(const r of reviews){const k=clean(r.body).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(!k||seen.has(k))continue;seen.add(k);out.push(r);if(out.length>=max)break}return out}
async function snapshot(input,{polls=72}={}){
  const key=process.env.BRIGHT_DATA_API_KEY||'';if(!key)return{ok:false,error:'api_key_missing'};
  let tr,txt;try{tr=await fetch(`https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET}&format=json&uncompressed_webhook=true`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','accept':'application/json'},body:JSON.stringify([input]),cache:'no-store',signal:AbortSignal.timeout(15000)});txt=await tr.text()}catch(e){return{ok:false,error:`trigger:${clean(e?.message||e)}`}}
  if(!tr.ok)return{ok:false,error:`trigger_http_${tr.status}:${clean(txt).slice(0,220)}`};let j;try{j=JSON.parse(txt)}catch{return{ok:false,error:`trigger_json:${clean(txt).slice(0,220)}`}}
  const id=String(j?.snapshot_id||j?.id||'');if(!id)return{ok:false,error:`missing_snapshot:${clean(txt).slice(0,220)}`};
  let status='starting';for(let i=0;i<polls;i++){await sleep(i?1500:700);try{const r=await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${key}`,'accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(8000)}),t=await r.text();if(!r.ok)continue;const p=JSON.parse(t);status=String(p?.status||status).toLowerCase();if(status==='ready')break;if(status==='failed')return{ok:false,snapshotId:id,error:`snapshot_failed:${clean(p?.error||p?.message||'failed')}`}}catch{}}
  if(status!=='ready')return{ok:false,pending:true,snapshotId:id,error:`snapshot_${status}`};
  let sr,raw;try{sr=await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(id)}?format=json`,{headers:{authorization:`Bearer ${key}`,'accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});raw=await sr.text()}catch(e){return{ok:false,snapshotId:id,error:`download:${clean(e?.message||e)}`}}
  if(!sr.ok)return{ok:false,snapshotId:id,error:`download_http_${sr.status}:${clean(raw).slice(0,220)}`};let data;try{data=JSON.parse(raw)}catch{return{ok:false,snapshotId:id,error:`download_json:${clean(raw).slice(0,220)}`}}return{ok:true,snapshotId:id,data};
}

export async function collectAmazonReviewsV2(source,{maxReviews=200}={}){
  const sourceUrl=source?.directSourceUrl||source?.sourceUrl||'';
  const asin=source?.asin||amazonAsinV2(sourceUrl),url=asin?`https://www.amazon.com/dp/${asin}`:canonicalAmazon(sourceUrl);
  if(!asin)return{reviews:[],provider:'bright_data_amazon_reviews_v2',attempted:0,failed:1,blocked:0,error:'missing_asin',canonicalUrl:url};
  const requested=Math.max(1,Math.min(Number(maxReviews)||200,250));
  const job=await snapshot({url,reviews_to_not_include:[],max_reviews:requested,variation_specific:false});
  if(!job.ok)return{reviews:[],provider:'bright_data_amazon_reviews_v2',attempted:1,failed:job.pending?0:1,blocked:0,pending:Boolean(job.pending),snapshotId:job.snapshotId||null,error:`bright_data_${job.error}`,canonicalUrl:url,requested};
  const parsed=parse(job.data),reviews=dedupe(parsed.reviews,requested),ids=[...new Set(parsed.reviews.map(r=>r.reviewId).filter(Boolean))];
  return{reviews,provider:'bright_data_amazon_reviews_v2',attempted:1,failed:0,blocked:0,pending:false,snapshotId:job.snapshotId,canonicalUrl:url,requested,rawRows:parsed.rows.length,parsedBodies:parsed.reviews.length,reviewIdCount:ids.length,reviewIds:ids.slice(0,250),rowKeys:parsed.keys,error:reviews.length?'':'bright_data_amazon_zero_reviews'};
}

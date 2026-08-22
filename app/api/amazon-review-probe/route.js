export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';
import{collectAmazonReviewsV2}from'../../../lib/amazon-review-ingest-v2';
import{getBrightDataBalance}from'../../../lib/bright-data-status';
import{amazonReviewsToCsv}from'../../../lib/amazon-review-csv.mjs';

const CONTROL=Object.freeze({asin:'B00MNV8E0C',maxReviews:50,maxBatches:1,runToken:'bounded-50'});
const RESUME_SNAPSHOT='sd_mt4nnysandbh3hajk';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const delta=(before,after)=>before===null||after===null?null:Number((before-after).toFixed(8));
const headerNumber=value=>value===null||value===undefined?'unknown':String(value);
const clean=value=>String(value??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const bodyKey=value=>clean(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

function snapshotRows(data){return Array.isArray(data)?data:Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[data]}
function snapshotRating(value){const n=Number(String(value??'').match(/([1-5](?:\.\d)?)/)?.[1]);return n>=1&&n<=5?n:null}
function snapshotReviewId(row){
  const direct=clean(row?.review_id||row?.reviewId||row?.review_identifier||row?.reviewIdentifier||row?.id||'');
  if(direct)return direct;
  for(const value of [row?.review_url,row?.reviewUrl,row?.url_review,row?.permalink]){const match=String(value||'').match(/(?:customer-reviews\/|\/review\/)(R[A-Z0-9]+)/i);if(match)return match[1].toUpperCase()}
  return'';
}
async function resumeSnapshot(source,snapshotId){
  const key=process.env.BRIGHT_DATA_API_KEY||'';
  const provider='bright_data_amazon_reviews_v2';
  if(!key)return{reviews:[],provider,attempted:1,newDatasetTriggers:0,failed:1,pending:false,requested:CONTROL.maxReviews,batches:[{batch:1,ok:false,snapshotId,error:'api_key_missing'}],error:'api_key_missing'};
  let status='running';
  for(let i=0;i<12;i++){
    if(i)await wait(1500);
    const progress=await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(snapshotId)}`,{headers:{authorization:`Bearer ${key}`,accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(8000)});
    const raw=await progress.text();
    if(!progress.ok)return{reviews:[],provider,attempted:1,newDatasetTriggers:0,failed:1,pending:false,requested:CONTROL.maxReviews,batches:[{batch:1,ok:false,snapshotId,error:`progress_http_${progress.status}:${clean(raw).slice(0,180)}`}],error:`progress_http_${progress.status}`};
    const payload=JSON.parse(raw);status=String(payload?.status||status).toLowerCase();
    if(status==='ready')break;
    if(status==='failed')return{reviews:[],provider,attempted:1,newDatasetTriggers:0,failed:1,pending:false,requested:CONTROL.maxReviews,batches:[{batch:1,ok:false,snapshotId,error:`snapshot_failed:${clean(payload?.error||payload?.message||'failed')}`}],error:'snapshot_failed'};
  }
  if(status!=='ready')return{reviews:[],provider,attempted:1,newDatasetTriggers:0,failed:0,pending:true,requested:CONTROL.maxReviews,batches:[{batch:1,ok:false,pending:true,snapshotId,error:`snapshot_${status}`}],error:`snapshot_${status}`};
  const response=await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(snapshotId)}?format=json`,{headers:{authorization:`Bearer ${key}`,accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(20000)});
  const raw=await response.text();
  if(!response.ok)return{reviews:[],provider,attempted:1,newDatasetTriggers:0,failed:1,pending:false,requested:CONTROL.maxReviews,batches:[{batch:1,ok:false,snapshotId,error:`download_http_${response.status}:${clean(raw).slice(0,180)}`}],error:`download_http_${response.status}`};
  const rows=snapshotRows(JSON.parse(raw)),reviews=[],seenBodies=new Set(),reviewIds=[];let aggregateRatingCount=null,aggregateRating=null;
  for(const row of rows){
    if(!row||typeof row!=='object')continue;
    const count=Number(String(row.product_rating_count??'').replace(/[^0-9.]/g,''));if(Number.isFinite(count)&&count>=0)aggregateRatingCount=aggregateRatingCount===null?count:Math.max(aggregateRatingCount,count);
    const productRating=Number(row.product_rating);if(Number.isFinite(productRating)&&productRating>0)aggregateRating=productRating;
    const body=clean(row.review_text||row.text||row.review_body||row.body||'');if(!body)continue;
    const keyValue=bodyKey(body);if(!keyValue||seenBodies.has(keyValue))continue;seenBodies.add(keyValue);
    const reviewId=snapshotReviewId(row);if(reviewId)reviewIds.push(reviewId);
    reviews.push({body,title:clean(row.review_header||row.review_title||row.title||'').slice(0,220),rating:snapshotRating(row.rating),reviewId,verifiedPurchase:Boolean(row.is_verified??row.verified_purchase),reviewDate:row.review_posted_date||row.review_date||row.date||null,authorName:clean(row.author_name||row.reviewer_name||'')});
    if(reviews.length>=CONTROL.maxReviews)break;
  }
  const batch={batch:1,ok:true,resumed:true,newDatasetTriggers:0,snapshotId,rawRows:rows.length,parsedBodies:reviews.length,newBodies:reviews.length,newReviewIds:reviewIds.length,totalBodies:reviews.length,totalReviewIds:reviewIds.length,aggregateRatingCount,aggregateRating,rowKeys:Object.keys(rows.find(row=>row&&typeof row==='object')||{}).slice(0,80)};
  return{reviews,provider,attempted:1,newDatasetTriggers:0,failed:0,pending:false,requested:CONTROL.maxReviews,rawRows:rows.length,parsedBodies:reviews.length,reviewIdCount:reviewIds.length,reviewIds,batches:[batch],aggregateRatingCount,aggregateRating,canonicalUrl:source.directSourceUrl,error:reviews.length?'':'bright_data_amazon_zero_reviews'};
}

export async function GET(req){
  const source={directSourceUrl:`https://www.amazon.com/dp/${CONTROL.asin}`,sourceUrl:`https://www.amazon.com/dp/${CONTROL.asin}`,platform:'amazon.com',asin:CONTROL.asin};
  const requestUrl=new URL(req.url);
  const resumeId=requestUrl.searchParams.get('resume')||'';
  const isResume=resumeId===RESUME_SNAPSHOT;
  if(resumeId&&!isResume)return Response.json({ok:false,error:'resume_snapshot_not_allowed'},{status:400,headers:{'cache-control':'no-store'}});
  if(requestUrl.searchParams.get('run')!==CONTROL.runToken&&!isResume){
    return Response.json({
      ok:true,
      executionStarted:false,
      message:`Add ?run=${CONTROL.runToken} to execute the paid probe once and download the CSV.`,
      source,
      control:{maxListings:1,maxReviews:CONTROL.maxReviews,maxBatches:CONTROL.maxBatches,maxDatasetTriggers:1,billingBasis:'pay per successfully delivered record'}
    },{headers:{'cache-control':'no-store'}});
  }

  const started=Date.now();
  const balanceKey=process.env.BRIGHT_DATA_BALANCE_API_KEY||process.env.BRIGHT_DATA_API_KEY||'';
  try{
    const before=await getBrightDataBalance(balanceKey,{force:true});
    console.log('[amazon-review-probe] bounded run started',{asin:CONTROL.asin,maxReviews:CONTROL.maxReviews,maxBatches:CONTROL.maxBatches,balanceReadable:before.ok===true});
    const result=isResume?await resumeSnapshot(source,RESUME_SNAPSHOT):await collectAmazonReviewsV2(source,{maxReviews:CONTROL.maxReviews,maxBatches:CONTROL.maxBatches});
    await wait(1200);
    const after=await getBrightDataBalance(balanceKey,{force:true});
    const beforeBalance=finite(before.balance),afterBalance=finite(after.balance),balanceDelta=delta(beforeBalance,afterBalance);
    const balance={before:beforeBalance,after:afterBalance,delta:balanceDelta,pendingBefore:finite(before.pendingBalance),pendingAfter:finite(after.pendingBalance)};
    const reviews=(result.reviews||[]).slice(0,CONTROL.maxReviews);
    const diagnostics={
      ok:reviews.length===CONTROL.maxReviews,
      executionStarted:true,
      source,
      control:{maxListings:1,maxReviews:CONTROL.maxReviews,maxBatches:CONTROL.maxBatches,maxDatasetTriggers:1,billingBasis:'pay per successfully delivered record'},
      exportedReviews:reviews.length,
      provider:result.provider,
      requested:result.requested,
      attempted:result.attempted,
      failed:result.failed,
      pending:result.pending,
      rawRows:result.rawRows,
      parsedBodies:result.parsedBodies,
      reviewIdCount:result.reviewIdCount,
      batches:result.batches||[],
      aggregateRatingCount:result.aggregateRatingCount,
      aggregateRating:result.aggregateRating,
      balance,
      balanceReadableBefore:before.ok===true,
      balanceReadableAfter:after.ok===true,
      elapsedMs:Date.now()-started,
      error:result.error||''
    };
    if(!reviews.length){
      console.error('[amazon-review-probe] bounded run failed',diagnostics);
      return Response.json(diagnostics,{status:502,headers:{'cache-control':'no-store'}});
    }
    const csv=amazonReviewsToCsv({reviews,source,result,control:CONTROL,balance});
    const filename=`amazon-reviews-${CONTROL.asin}-${reviews.length}-${new Date().toISOString().slice(0,10)}.csv`;
    console.log('[amazon-review-probe] bounded run completed',{asin:CONTROL.asin,requested:CONTROL.maxReviews,exported:reviews.length,triggers:result.attempted,balanceDelta,elapsedMs:diagnostics.elapsedMs});
    return new Response(csv,{status:200,headers:{
      'content-type':'text/csv; charset=utf-8',
      'content-disposition':`attachment; filename="${filename}"`,
      'cache-control':'no-store',
      'x-srl-cost-control':'one-listing-one-batch-max-50',
      'x-srl-reviews-requested':String(CONTROL.maxReviews),
      'x-srl-reviews-exported':String(reviews.length),
      'x-srl-bright-data-triggers':String(result.attempted||0),
      'x-srl-new-bright-data-triggers':String(result.newDatasetTriggers??result.attempted??0),
      'x-srl-bright-data-snapshot':String(result.batches?.[0]?.snapshotId||''),
      'x-srl-bright-data-balance-before':headerNumber(beforeBalance),
      'x-srl-bright-data-balance-after':headerNumber(afterBalance),
      'x-srl-bright-data-balance-delta':headerNumber(balanceDelta),
      'x-srl-probe-complete':reviews.length===CONTROL.maxReviews?'true':'partial'
    }});
  }catch(e){
    console.error('[amazon-review-probe] bounded run exception',{error:e?.message||String(e)});
    return Response.json({ok:false,executionStarted:true,control:{maxListings:1,maxReviews:CONTROL.maxReviews,maxBatches:CONTROL.maxBatches,maxDatasetTriggers:1},error:e?.message||String(e)},{status:500,headers:{'cache-control':'no-store'}})
  }
}

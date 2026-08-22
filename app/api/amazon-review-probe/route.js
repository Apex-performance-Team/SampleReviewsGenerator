export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';
import{collectAmazonReviewsV2}from'../../../lib/amazon-review-ingest-v2';
import{getBrightDataBalance}from'../../../lib/bright-data-status';
import{amazonReviewsToCsv}from'../../../lib/amazon-review-csv.mjs';

const CONTROL=Object.freeze({asin:'B0CKYX98FX',maxReviews:50,maxBatches:1,runToken:'bounded-50'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const delta=(before,after)=>before===null||after===null?null:Number((before-after).toFixed(8));
const headerNumber=value=>value===null||value===undefined?'unknown':String(value);

export async function GET(req){
  const source={directSourceUrl:`https://www.amazon.com/dp/${CONTROL.asin}`,sourceUrl:`https://www.amazon.com/dp/${CONTROL.asin}`,platform:'amazon.com',asin:CONTROL.asin};
  const requestUrl=new URL(req.url);
  if(requestUrl.searchParams.get('run')!==CONTROL.runToken){
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
    const result=await collectAmazonReviewsV2(source,{maxReviews:CONTROL.maxReviews,maxBatches:CONTROL.maxBatches});
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

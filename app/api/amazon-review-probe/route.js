export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';

import{collectAmazonReviewsV2,amazonAsinV2}from'../../../lib/amazon-review-ingest-v2';
import{amazonReviewsToCsv}from'../../../lib/amazon-review-csv.mjs';
import{getBrightDataBalance}from'../../../lib/bright-data-status';

const MAX_REVIEWS=50;
const MAX_BATCHES=1;
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
const number=x=>{const n=Number(x);return Number.isFinite(n)?n:null};

function tokenFrom(req){
  const auth=clean(req.headers.get('authorization'));
  if(/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,'');
  return clean(req.headers.get('x-amazon-probe-token'));
}

export async function GET(){
  return Response.json({
    ok:true,
    live:false,
    message:'Amazon probe is idle. GET never triggers a Bright Data job.',
    control:{maxReviews:MAX_REVIEWS,maxBatches:MAX_BATCHES,paidTriggers:0},
    liveProbeConfigured:Boolean(process.env.AMAZON_PROBE_TOKEN)
  },{headers:{'cache-control':'no-store'}})
}

export async function POST(req){
  const expected=clean(process.env.AMAZON_PROBE_TOKEN);
  if(!expected)return Response.json({ok:false,error:'Live Amazon probe is disabled.'},{status:503,headers:{'cache-control':'no-store'}});
  if(tokenFrom(req)!==expected)return Response.json({ok:false,error:'Unauthorized.'},{status:401,headers:{'cache-control':'no-store'}});
  let body;try{body=await req.json()}catch{return Response.json({ok:false,error:'Invalid JSON body.'},{status:400,headers:{'cache-control':'no-store'}})}
  const asin=amazonAsinV2(body?.asin||body?.url||'');
  if(!asin)return Response.json({ok:false,error:'A valid Amazon ASIN or listing URL is required.'},{status:400,headers:{'cache-control':'no-store'}});
  const maxReviews=Math.max(1,Math.min(MAX_REVIEWS,Math.floor(number(body?.maxReviews)||MAX_REVIEWS)));
  const source={directSourceUrl:`https://www.amazon.com/dp/${asin}`,sourceUrl:`https://www.amazon.com/dp/${asin}`,platform:'amazon.com',asin};
  const balanceKey=process.env.BRIGHT_DATA_BALANCE_API_KEY||process.env.BRIGHT_DATA_API_KEY||'';
  const before=await getBrightDataBalance(balanceKey,{force:true});
  try{
    const result=await collectAmazonReviewsV2(source,{maxReviews,maxBatches:MAX_BATCHES});
    const after=await getBrightDataBalance(balanceKey,{force:true});
    const beforeValue=number(before.balance),afterValue=number(after.balance),delta=beforeValue!==null&&afterValue!==null?Number((beforeValue-afterValue).toFixed(6)):null;
    const balance={before:beforeValue,after:afterValue,delta,pendingBefore:number(before.pendingBalance),pendingAfter:number(after.pendingBalance)};
    const control={maxReviews,maxBatches:MAX_BATCHES,paidTriggerCap:1};
    if(String(body?.format||'').toLowerCase()==='csv'){
      const csv=amazonReviewsToCsv({reviews:result.reviews||[],source,result,control,balance});
      if(!csv)return Response.json({ok:false,error:result.error||'Amazon returned no review rows.',result:{requested:maxReviews,exported:0,attempted:result.attempted||0,pending:Boolean(result.pending),snapshotIds:(result.batches||[]).map(x=>x.snapshotId).filter(Boolean)},balance},{status:result.pending?202:502,headers:{'cache-control':'no-store'}});
      return new Response(csv,{status:200,headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="amazon-reviews-${asin}-${(result.reviews||[]).length}.csv"`,'cache-control':'no-store','x-amazon-review-count':String((result.reviews||[]).length),'x-bright-data-trigger-count':String(result.attempted||0)}})
    }
    return Response.json({ok:Boolean(result.reviews?.length),asin,control,count:result.reviews?.length||0,result:{attempted:result.attempted||0,failed:result.failed||0,pending:Boolean(result.pending),canonicalUrl:result.canonicalUrl,requested:result.requested,aggregateRatingCount:result.aggregateRatingCount,aggregateRating:result.aggregateRating,rawRows:result.rawRows,parsedBodies:result.parsedBodies,reviewIdCount:result.reviewIdCount,batches:result.batches||[],elapsedMs:result.elapsedMs,error:result.error||''},balance},{status:result.pending?202:result.reviews?.length?200:502,headers:{'cache-control':'no-store'}})
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500,headers:{'cache-control':'no-store'}})}
}

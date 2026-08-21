export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';
import{collectAmazonReviewsV2}from'../../../lib/amazon-review-ingest-v2';
const ASINS=['B089LMG6L4','B0BNTY8SX9','B0CKYX98FX','B0D73PDXQP','B0F5W3XRJS','B0DD6W87QF','B0DZWZ3H6L'];
export async function GET(){
  const started=Date.now();
  const results=await Promise.all(ASINS.map(async asin=>{try{const r=await collectAmazonReviewsV2({directSourceUrl:`https://www.amazon.com/dp/${asin}`,sourceUrl:`https://www.amazon.com/dp/${asin}`,platform:'amazon.com',asin},{maxReviews:250,maxBatches:1});return{asin,ok:Boolean(r.reviews?.length),count:r.reviews?.length||0,aggregateRatingCount:r.aggregateRatingCount,aggregateRating:r.aggregateRating,rawRows:r.rawRows,reviewIdCount:r.reviewIdCount,snapshotId:r.batches?.[0]?.snapshotId||null,elapsedMs:r.elapsedMs,error:r.error||''}}catch(e){return{asin,ok:false,error:e?.message||String(e)}}}));
  return Response.json({ok:true,elapsedMs:Date.now()-started,results:results.sort((a,b)=>(b.aggregateRatingCount||0)-(a.aggregateRatingCount||0))},{headers:{'cache-control':'no-store'}})
}

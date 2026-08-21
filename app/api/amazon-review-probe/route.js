export const runtime='nodejs';
export const maxDuration=180;
export const dynamic='force-dynamic';
import{collectAmazonReviewsV2}from'../../../lib/amazon-review-ingest-v2';
export async function GET(){
  const source={directSourceUrl:'https://www.amazon.com/dp/B0845Y7DGS',sourceUrl:'https://www.amazon.com/dp/B0845Y7DGS',platform:'amazon.com',asin:'B0845Y7DGS'};
  try{
    const r=await collectAmazonReviewsV2(source,{maxReviews:250});
    return Response.json({ok:Boolean(r.reviews?.length),count:r.reviews?.length||0,attempted:r.attempted,failed:r.failed,pending:r.pending,snapshotId:r.snapshotId,canonicalUrl:r.canonicalUrl,requested:r.requested,rawRows:r.rawRows,parsedBodies:r.parsedBodies,reviewIdCount:r.reviewIdCount,rowKeys:r.rowKeys,sampleIds:(r.reviewIds||[]).slice(0,20),sampleReviews:(r.reviews||[]).slice(0,3).map(x=>({reviewId:x.reviewId,title:x.title,rating:x.rating,body:x.body})),error:r.error||''},{headers:{'cache-control':'no-store'}})
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500,headers:{'cache-control':'no-store'}})}
}

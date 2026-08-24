const clean=value=>String(value??'').replace(/\s+/g,' ').trim();

function addReason(map,id,reason){
  const key=clean(id),value=clean(reason).slice(0,360);
  if(!key||!value)return;
  const reasons=map.get(key)||[];
  if(!reasons.includes(value))reasons.push(value);
  map.set(key,reasons.slice(0,10));
}

export function reviewRatingSummary(reviews=[]){
  const distribution={5:0,4:0,3:0,2:0,1:0};
  let ratingTotal=0,count=0;
  for(const review of Array.isArray(reviews)?reviews:[]){
    const rating=Number(review?.rating);
    if(!Number.isInteger(rating)||rating<1||rating>5)continue;
    distribution[rating]++;
    ratingTotal+=rating;
    count++;
  }
  return{finalReviewCount:(Array.isArray(reviews)?reviews:[]).length,ratedReviewCount:count,distribution,actualAverage:count?ratingTotal/count:null};
}

export function quarantineFailedReviews(reviews=[],{
  deterministicDiagnostics={},
  semanticRepairIds=[],
  semanticRepairReasons={},
}={}){
  const source=Array.isArray(reviews)?reviews:[],reasonsById=new Map();
  for(const id of deterministicDiagnostics?.repairIds||[]){
    const reasons=deterministicDiagnostics?.repairReasons?.[id]||['deterministic_diversity_check_failed'];
    for(const reason of reasons)addReason(reasonsById,id,reason);
  }
  for(const id of semanticRepairIds||[]){
    const reasons=semanticRepairReasons?.[id]||['semantic_corpus_check_failed'];
    for(const reason of reasons)addReason(reasonsById,id,reason);
  }
  const acceptedReviews=[],purgedReviews=[];
  for(const review of source){
    const reasons=reasonsById.get(String(review?.id||''));
    if(!reasons){acceptedReviews.push(review);continue}
    purgedReviews.push({...review,excludedFromFinalOutput:true,qualityPurgeReasons:reasons});
  }
  const summary=reviewRatingSummary(acceptedReviews);
  return{
    reviews:acceptedReviews,
    purgedReviews,
    purgedReviewIds:purgedReviews.map(review=>review.id),
    purgedReviewCount:purgedReviews.length,
    generatedReviewCount:source.length,
    ...summary,
  };
}

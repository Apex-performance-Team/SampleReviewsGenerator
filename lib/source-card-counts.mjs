function nonNegativeCount(value){
  if(value===null||value===undefined||value==='')return null;
  const count=Number(value);
  return Number.isFinite(count)&&count>=0?count:null;
}

export function sourceCardCounts(source={}){
  const extracted=Math.max(0,...[
    source.individualExtractedCount,
    source.extractedReviewCount,
    source.reviewCount
  ].map(nonNegativeCount).filter(value=>value!==null));
  const publicCount=[
    source.publicReviewCount,
    source.reviewCountEstimate,
    source.aggregateRatingCount,
    source.itemFeedbackCount,
    source.ratingCount,
    source.ratingCountEstimate
  ].map(nonNegativeCount).find(value=>value!==null);
  const listed=publicCount===undefined?null:Math.max(publicCount,extracted);
  return{extracted,listed,headline:listed??(extracted>0?extracted:null),sortCount:listed??(extracted>0?extracted:-1)};
}

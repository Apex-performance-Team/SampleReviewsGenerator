export const RESULT_PAGE_SIZE=100;
export async function loadProductPages(fetchPage){
  const first=await fetchPage(0),reviews=[...first.reviews],total=first.pagination.total;
  for(let offset=first.pagination.nextOffset;offset!==null&&offset<total;offset+=4*RESULT_PAGE_SIZE){
    const offsets=Array.from({length:4},(_,i)=>offset+i*RESULT_PAGE_SIZE).filter(value=>value<total);
    const pages=await Promise.all(offsets.map(fetchPage));
    for(const page of pages){
      if(page.pagination.total!==total)throw Error('Review results changed while loading. Please reload.');
      reviews.push(...page.reviews);
    }
  }
  if(reviews.length!==total)throw Error('The complete review result could not be loaded. Please retry.');
  return{...first.product,reviews};
}
export function resultPage(product,offset=0){
  offset=Math.max(0,Math.floor(Number(offset)||0));
  const {reviews=[],purgedReviews=[],...metadata}=product;
  const end=Math.min(reviews.length,offset+RESULT_PAGE_SIZE);
  return{product:offset===0?{...metadata,reviews:[],purgedReviews}:null,reviews:reviews.slice(offset,end),pagination:{offset,total:reviews.length,nextOffset:end<reviews.length?end:null}};
}
export function publicReviewRun(run,offset=0){
  if(run.requested_count<=250)return run;
  const result=run.result_json||{},final=result.finalResult||{},page=resultPage({...final,reviews:final.reviews||result.reviews||[]},offset);
  return{...run,result_json:{corpusDiagnostics:result.corpusDiagnostics,corpusRepairCount:result.corpusRepairCount,finalResult:result.finalResult?{...page.product,reviews:page.reviews}:undefined,reviews:page.reviews},pagination:page.pagination};
}
export function streamText(text){
  const encoder=new TextEncoder();let offset=0;
  return new ReadableStream({pull(controller){
    if(offset>=text.length){controller.close();return}
    let end=Math.min(text.length,offset+32768);
    // Avoid splitting a UTF-16 surrogate pair across separately encoded chunks.
    if(end<text.length&&text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
    controller.enqueue(encoder.encode(text.slice(offset,end)));offset=end;
  }});
}

function finalResultFromRun(run){
  const result=run?.result_json||{};
  return result.finalResult||{...(result||{}),input:{...(run?.input_json||{}),reviewCount:run?.requested_count,targetAverage:run?.input_json?.targetAverage},reviews:result.reviews||[],purgedReviews:result.purgedReviews||[],purgedReviewCount:run?.purged_count||0,finalReviewCount:run?.completed_count||0,runId:run?.id,datasetPurpose:'internal_qa_modeling'};
}

export function compactReviewRun(run){
  return{id:run.id,status:run.status,mode:run.mode,productTitle:run.product_title,productUrl:run.product_url,requestedCount:Number(run.requested_count)||0,completedCount:Number(run.completed_count)||0,purgedCount:Number(run.purged_count)||0,currentStep:run.current_step||'',progressMessage:run.progress_message||'',error:run.error||null,updatedAt:run.updated_at};
}

export function catalogStatus(catalog,children,workflowStatus=null){
  const rows=Array.isArray(children)?children:[],requested=Number(catalog?.requested_count)||rows.reduce((n,x)=>n+(Number(x.requested_count)||0),0),completed=rows.reduce((n,x)=>n+(Number(x.completed_count)||0),0),purged=rows.reduce((n,x)=>n+(Number(x.purged_count)||0),0),completeSkus=rows.filter(x=>x.status==='completed').length,failedSkus=rows.filter(x=>x.status==='failed').length;
  return{catalog:{id:catalog.id,status:catalog.status,mode:catalog.mode,requestedCount:requested,completedCount:completed,purgedCount:purged,currentStep:catalog.current_step,progressMessage:catalog.progress_message,error:catalog.error,createdAt:catalog.created_at,updatedAt:catalog.updated_at,workflowRunId:catalog.result_json?.workflowRunId||null,workflowStatus},progress:{done:Math.min(requested,completed),total:requested,percent:requested?Math.floor(Math.min(requested,completed)/requested*100):0,completeSkus,failedSkus,totalSkus:rows.length},children:rows.map(compactReviewRun)};
}

export function buildCatalogResult(catalog,children){
  const products=(Array.isArray(children)?children:[]).map(run=>{const final=finalResultFromRun(run),input=run.input_json||{};return{...final,productUrl:run.product_url||input.productUrl,productTitle:run.product_title||input.productTitle,existingReviewCount:input.existingReviewCount??null,requestedReviewCount:Number(run.requested_count)||0,reviewCount:final.reviews?.length||0,targetAverage:Number(input.targetAverage)||4.7,runStatus:run.status,runError:run.error||null}}),total=products.reduce((n,p)=>n+(Number(p.requestedReviewCount)||0),0),totalReviews=products.reduce((n,p)=>n+(p.reviews?.length||0),0),totalPurgedReviews=products.reduce((n,p)=>n+(Number(p.purgedReviewCount)||0),0);
  return{runId:catalog.id,workflowRunId:catalog.result_json?.workflowRunId||null,products,skuCount:products.length,generatedReviewCount:total,totalReviews,totalPurgedReviews,targetAverage:Number(catalog.input_json?.targetAverage)||4.7,reviewCountPerSku:null,customReviewCounts:true,reviewCountsBySku:products.map(p=>({productTitle:p.productTitle,productUrl:p.productUrl,requestedReviewCount:p.requestedReviewCount})),synthetic:true,fixtureType:'synthetic_review_qa',publicationAllowed:false,datasetPurpose:'internal_qa_modeling'};
}

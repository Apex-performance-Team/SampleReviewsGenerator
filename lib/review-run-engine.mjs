import{getRun,updateRun}from'./review-run-store.mjs';
import{reviewRatingSummary}from'./review-quality-finalize.mjs';
import{syntheticReviewCsv}from'./synthetic-review-export.mjs';
import{areviewsReviewCsv}from'./areviews-export.mjs';

const BATCH=10;
function clean(value,max=1000){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function originFrom(req){return new URL(req.url).origin}
async function postJson(origin,path,body){
  const r=await fetch(`${origin}${path}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(j.error||`${path} failed (${r.status})`);
  return j;
}
function appendStep(result,step,status,detail={}){
  return{...result,steps:[...(Array.isArray(result?.steps)?result.steps:[]),{step,status,detail,at:new Date().toISOString()}].slice(-80)};
}
function finalResult(run,result,input){
  const reviews=(result.reviews||[]).slice(0,run.requested_count),purgedReviews=result.purgedReviews||[],summary=reviewRatingSummary(reviews);
  return{input:{productUrl:input.productUrl||run.product_url,productTitle:input.productTitle||run.product_title,productDescription:input.productDescription||'',reviewCount:run.requested_count,targetAverage:input.targetAverage},reviews,purgedReviews,generatedReviewCount:reviews.length+purgedReviews.length,finalReviewCount:reviews.length,purgedReviewCount:purgedReviews.length,distribution:summary.distribution,originalDistribution:result.plan?.distribution||summary.distribution,actualAverage:summary.actualAverage,planId:result.plan?.planId||result.planId||'SERVER-RUN',runId:run.id,planGeneratedAt:result.plan?.generatedAt||run.created_at,plannerModel:result.plan?.plannerModel||result.plannerModel||'',model:result.model||'',referenceCoverage:result.referenceCoverage||{available:0,referenceLedTotal:0,pdpOnlyTotal:reviews.length,scope:'dataset'},corpusDiagnostics:result.corpusDiagnostics||{qaStatus:'server_completed'},corpusRepairCount:0,generationCallBudget:result.generationCallBudget||{},datasetPurpose:'internal_qa_modeling',diagnostics:result.diagnostics||{}};
}
async function ensureScanned(run,origin){
  const input={...(run.input_json||{})};
  if(input.productTitle&&input.productDescription)return{input,result:run.result_json||{}};
  if(!input.productUrl)throw Error('Product URL or product title/context is required.');
  await updateRun(run.id,{status:'running',current_step:'scan_pdp',progress_message:'Scanning product page…'});
  const scan=await postJson(origin,'/api/scan',{url:input.productUrl,amazonListingUrl:input.amazonListingUrl||'',deferReferenceScan:true});
  const nextInput={...input,productUrl:scan.productUrl,amazonListingUrl:scan.amazonListingUrl||input.amazonListingUrl||'',productTitle:scan.productTitle,productDescription:scan.productDescription,extracted:scan.extracted};
  const result=appendStep(run.result_json||{},'scan_pdp','completed',{productTitle:scan.productTitle});
  await updateRun(run.id,{product_title:scan.productTitle,product_url:scan.productUrl,input_json:nextInput,result_json:result,current_step:'scan_pdp',progress_message:'Product page scanned.'});
  return{input:nextInput,result};
}
async function processPdp(run,origin,input,result){
  if(!result.plan){
    await updateRun(run.id,{status:'running',current_step:'plan',progress_message:'Planning PDP-only review corpus…'});
    const plan=await postJson(origin,'/api/generation-plan',{...input,reviewCount:run.requested_count,targetAverage:Number(input.targetAverage)||4.7,externalReferencesEnabled:false});
    result=appendStep({...result,plan},'plan','completed',{items:plan.items?.length||0});
    return updateRun(run.id,{status:'running',current_step:'generate',progress_message:'Plan saved. Ready for first generation batch.',result_json:result});
  }
  const reviews=Array.isArray(result.reviews)?result.reviews:[],items=result.plan.items||[];
  if(reviews.length<run.requested_count){
    const offset=reviews.length,batchItems=items.slice(offset,offset+BATCH);
    await updateRun(run.id,{status:'running',current_step:'generate',progress_message:`Generating PDP batch ${offset+1}-${offset+batchItems.length}…`});
    const batch=await postJson(origin,'/api/generate',{...input,reviewCount:run.requested_count,targetAverage:Number(input.targetAverage)||4.7,generationMode:'blueprint_v2',planId:result.plan.planId,runId:result.plan.runId,plannerModel:result.plan.plannerModel,offset,batchSize:batchItems.length,planItems:batchItems});
    const nextReviews=[...reviews,...(batch.reviews||[])].slice(0,run.requested_count);
    result=appendStep({...result,reviews:nextReviews,model:batch.model||result.model,generationCallBudget:{...(result.generationCallBudget||{}),aiCallsAttempted:(result.generationCallBudget?.aiCallsAttempted||0)+1}},'generate','completed',{added:batch.reviews?.length||0,total:nextReviews.length});
    return updateRun(run.id,{status:'running',completed_count:nextReviews.length,current_step:'generate',progress_message:`Generated ${nextReviews.length}/${run.requested_count}.`,result_json:result});
  }
  if(!result.corpusDiagnostics){
    await updateRun(run.id,{status:'running',current_step:'qa',progress_message:'Running corpus QA assessment…'});
    try{
      const qa=await postJson(origin,'/api/corpus-qa',{mode:'assess',productTitle:input.productTitle,productDescription:input.productDescription,reviews});
      result=appendStep({...result,corpusDiagnostics:{...(qa.diagnostics||{}),qaStatus:'server_completed'},diagnostics:{uniqueBodies:new Set(reviews.map(x=>String(x.body||'').toLowerCase().trim())).size,uniqueTitles:new Set(reviews.map(x=>String(x.title||'').toLowerCase().trim())).size,uniquePersonaProfiles:new Set(reviews.map(x=>x.personaId).filter(Boolean)).size}},'qa','completed',{model:qa.model});
    }catch(error){
      result=appendStep({...result,corpusDiagnostics:{qaStatus:'server_completed_without_ai_qa',qaError:clean(error.message,300)}},'qa','warning',{error:error.message});
    }
    return updateRun(run.id,{status:'running',current_step:'finalize',progress_message:'QA saved. Ready to finalize.',result_json:result});
  }
  result=appendStep({...result,finalResult:finalResult(run,result,input)},'finalize','completed');
  return updateRun(run.id,{status:'completed',completed_count:run.requested_count,purged_count:(result.purgedReviews||[]).length,current_step:'completed',progress_message:'Completed. CSV export is ready.',result_json:result,completed_at:new Date().toISOString()});
}
async function ensureReferences(run,origin,input,result){
  if(Array.isArray(input.references)&&input.references.length)return{input,result};
  if(Array.isArray(result.referenceSet?.references)&&result.referenceSet.references.length)return{input:{...input,references:result.referenceSet.references},result};
  await updateRun(run.id,{status:'running',current_step:'source_scan',progress_message:'Finding external review sources…'});
  const scan=await postJson(origin,'/api/reference-scan',{...input,referenceBudget:input.referenceBudget||'balanced',targetSourceCount:5,targetReferenceCount:250,originalReviewCount:input.extracted?.existingReviewCount??null});
  let referenceSet=scan.referenceSet;
  await updateRun(run.id,{result_json:appendStep({...result,referenceSet},'source_scan','completed',{sources:referenceSet?.sourceCounts?.length||0}),progress_message:'Source scan saved. Pulling marketplace review bodies…'});
  const enriched=await postJson(origin,'/api/reference-enrich-marketplaces',{referenceSet,maxMarketplaceReviews:Math.min(200,run.requested_count),marketplaceTargetReviews:Math.min(200,run.requested_count),targetSourceCount:5});
  referenceSet=enriched.referenceSet||referenceSet;
  const references=referenceSet?.references||referenceSet?.pulledReferences||[];
  if(!references.length)throw Error('No source review bodies were available for reference rewrite.');
  result=appendStep({...result,referenceSet},'marketplace_pull','completed',{references:references.length});
  input={...input,references};
  await updateRun(run.id,{input_json:input,result_json:result});
  return{input,result};
}
async function processSourceRewrite(run,origin,input,result){
  ({input,result}=await ensureReferences(run,origin,input,result));
  const reviews=Array.isArray(result.reviews)?result.reviews:[],purgedReviews=Array.isArray(result.purgedReviews)?result.purgedReviews:[],sourceOffset=Number(result.sourceOffset)||0;
  if(reviews.length<run.requested_count&&sourceOffset<250){
    await updateRun(run.id,{status:'running',current_step:'source_rewrite',progress_message:`Rewriting source batch at offset ${sourceOffset}…`});
    const batch=await postJson(origin,'/api/source-rewrite-simple',{...input,reviewCount:run.requested_count,offset:sourceOffset,batchSize:Math.min(BATCH,run.requested_count-reviews.length),references:input.references});
    const nextReviews=[...reviews,...(batch.reviews||[])].slice(0,run.requested_count),nextPurged=[...purgedReviews,...(batch.rejected||[]).map((x,i)=>({id:x.referenceId||`PURGED-${sourceOffset+i+1}`,rating:x.sourceRating??'',title:x.sourceTitle||'',body:x.sourceBody||'',referenceLed:true,excludedFromFinalOutput:true,qualityPurgeReasons:[x.rejectReason||'source_rewrite_rejected'],referenceSourceBody:x.sourceBody||'',referenceSourceTitle:x.sourceTitle||'',referenceSourceReviewProductTitle:x.sourceReviewProductTitle||'',referenceSourceUrl:x.sourceUrl||''}))],nextOffset=Number(batch.nextOffset)||sourceOffset+BATCH;
    result=appendStep({...result,reviews:nextReviews,purgedReviews:nextPurged,sourceOffset:nextOffset,referenceCoverage:{available:batch.availableCount||input.references.length,referenceLedTotal:nextReviews.length,pdpOnlyTotal:0,scope:'dataset'},plannerModel:'source-rewrite-simple',model:'openai/gpt-5.6-sol'},'source_rewrite','completed',{added:batch.reviews?.length||0,purged:batch.rejected?.length||0,nextOffset});
    const done=nextReviews.length>=run.requested_count||batch.done||nextOffset>=250;
    return updateRun(run.id,{status:done?'running':'running',completed_count:nextReviews.length,purged_count:nextPurged.length,current_step:done?'finalize':'source_rewrite',progress_message:done?'Source rewrite batches done. Ready to finalize.':`Rewritten ${nextReviews.length}/${run.requested_count}; ${nextPurged.length} purged.`,result_json:result});
  }
  const reviewsNow=result.reviews||[];
  if(!reviewsNow.length)throw Error('Source rewrite produced zero final reviews.');
  result=appendStep({...result,corpusDiagnostics:{qaStatus:(result.purgedReviews||[]).length?'completed_with_purge':'completed',pipeline:'source_rewrite_simple'},diagnostics:{uniqueBodies:new Set(reviewsNow.map(x=>String(x.body||'').toLowerCase().trim())).size,uniqueTitles:new Set(reviewsNow.map(x=>String(x.title||'').toLowerCase().trim())).size,uniquePersonaProfiles:0}},'finalize','completed');
  result={...result,finalResult:finalResult(run,result,input)};
  return updateRun(run.id,{status:'completed',completed_count:reviewsNow.length,purged_count:(result.purgedReviews||[]).length,current_step:'completed',progress_message:'Completed. CSV export is ready.',result_json:result,completed_at:new Date().toISOString()});
}
export async function advanceRun(id,origin){
  let run=await getRun(id);
  if(['completed','canceled'].includes(run.status))return run;
  const scanned=await ensureScanned(run,origin);run=await getRun(id);
  return run.mode==='source_rewrite'?processSourceRewrite(run,origin,scanned.input,run.result_json||{}):processPdp(run,origin,scanned.input,run.result_json||{});
}
export async function processRun(req,id){
  try{return await advanceRun(id,originFrom(req))}
  catch(error){return updateRun(id,{status:'failed',current_step:'failed',progress_message:'Run failed.',error:clean(error.message,1000)})}
}
export function csvForRun(run){
  const result=run.result_json?.finalResult||finalResult(run,run.result_json||{},run.input_json||{});
  return syntheticReviewCsv(result);
}
export function areviewsCsvForRun(run,options={}){
  const result=run.result_json?.finalResult||finalResult(run,run.result_json||{},run.input_json||{});
  return areviewsReviewCsv(result,options);
}

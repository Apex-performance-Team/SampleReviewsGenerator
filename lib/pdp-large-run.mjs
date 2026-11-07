import{PDP_QUALITY_POLICY,qualityReview,qualityState}from'./pdp-quality-policy.mjs';
import {createBlueprintPlan, requestedThemeCount, sanitizeThemes, corpusQualitySignals} from './review-blueprint.mjs';
import {PDP_QA_CHUNK_SIZE} from './review-limits.mjs';
import {PDP_MAX_REPAIR_ROUNDS, PDP_REPAIR_BATCH_SIZE, pdpRepairIds, mergePdpRepairs} from './pdp-corpus-repair.mjs';
import {PDP_THEME_BATCH_SIZE, PDP_PLANNING_STALL_LIMIT, planningErrorCode, blockedPlanningError} from './pdp-planning-policy.mjs';

// Large plans are assembled across durable steps; never ask one model call
// to emit hundreds of themes or thousands of assignments.
export async function advanceLargePdpPlan({run, origin, input, result, postJson, updateRun}) {
  const planning=result.pdpPlanning||{themes:[],batches:[]},total=requestedThemeCount(run.requested_count);
  if(planning.blocked)throw blockedPlanningError(planning.lastError||'PDP planning needs attention. Saved progress is intact.');
  if(planning.themes.length<total){
    const batchSize=Math.max(1,Math.min(PDP_THEME_BATCH_SIZE,Number(planning.batchSize)||PDP_THEME_BATCH_SIZE));
    const count=Math.min(batchSize,total-planning.themes.length),attempts=(planning.attempts??planning.batches.length)+1;
    if(attempts>total*2+24)throw blockedPlanningError('PDP planning reached its request budget. Saved progress is intact.');
    let part,themes;
    try{
      part=await postJson(origin,'/api/generation-plan',{
        ...input,planningMode:'theme_batch',themeCount:count,reviewCount:run.requested_count,
        targetAverage:Number(input.targetAverage)||4.7,externalReferencesEnabled:false,
        previousThemes:planning.themes.map(theme=>theme.focus),
      });
      if(part.plannerFallbackReason)throw Error(part.plannerFallbackReason);
      // Keep valid partial output; a duplicate or missing theme must not erase
      // usable new themes or any previously checkpointed work.
      themes=sanitizeThemes([...planning.themes,...(part.themes||[]).slice(0,count)],{minimum:planning.themes.length+1,maximum:total});
    }catch(error){
      const code=planningErrorCode(error);
      if(['PLANNER_BILLING','PLANNER_AUTH','PLANNER_INPUT','PLANNER_RATE_LIMIT'].includes(code)){error.code=code;throw error}
      const stalledAttempts=(planning.stalledAttempts||0)+1,nextBatchSize=Math.max(1,Math.floor(count/2));
      const blocked=stalledAttempts>=PDP_PLANNING_STALL_LIMIT,lastError=String(error.message||error).slice(0,500);
      // Return a saved checkpoint instead of throwing into a retry of the
      // same request. The next durable step reads the reduced batch size.
      return updateRun(run.id,{status:'running',current_step:blocked?'planning_review_required':'plan_retry',progress_message:blocked?'PDP planning is unavailable after repeated attempts. Saved progress is intact.':`Planning request did not finish. ${planning.themes.length}/${total} themes saved; next request: ${nextBatchSize} theme${nextBatchSize===1?'':'s'}.`,result_json:{...result,pdpPlanning:{...planning,batchSize:nextBatchSize,attempts,stalledAttempts,blocked,lastError,lastErrorCode:code}}});
    }
    const added=themes.length-planning.themes.length;
    return updateRun(run.id,{status:'running',error:null,current_step:'plan',progress_message:`Planned ${themes.length}/${total} PDP themes.`,result_json:{...result,pdpPlanning:{themes,batchSize:Math.min(batchSize,added),attempts,stalledAttempts:0,batches:[...planning.batches,{model:part.plannerModel,provider:part.plannerProvider,count:added}]}}});
  }
  const plan=createBlueprintPlan({...input,reviewCount:run.requested_count,targetAverage:Number(input.targetAverage)||4.7,themes:planning.themes,references:[],now:Date.parse(run.created_at)||Date.now(),nonce:run.id});
  plan.plannerModel=planning.batches.at(-1)?.model;
  plan.plannerProvider=planning.batches.at(-1)?.provider;
  plan.plannerBatchCount=planning.batches.length;
  const {pdpPlanning,...rest}=result;
  return updateRun(run.id,{status:'running',current_step:'generate',progress_message:`Plan saved for ${plan.items.length} reviews.`,result_json:{...rest,plan}});
}

export function largeAssessmentChunks(reviews,round=0){
  // Two orders expose serious copies across distant generation batches.
  // Theme grouping is comparison context, never a topic-frequency test.
  const themeOrder=[...reviews].sort((a,b)=>String(a.blueprint?.themeId||'').localeCompare(String(b.blueprint?.themeId||''))||String(a.id).localeCompare(String(b.id)));
  return (reviews.length<=50?[reviews]:[reviews,themeOrder]).flatMap((order,pass)=>{
    const shift=(round*13+pass*7)%order.length,rotated=[...order.slice(shift),...order.slice(0,shift)],chunks=[];
    for(let i=0;i<rotated.length;i+=PDP_QA_CHUNK_SIZE)chunks.push(rotated.slice(i,i+PDP_QA_CHUNK_SIZE));
    // The assessor needs at least five reviews. Pad the final short chunk
    // with earlier context, retaining every original ID in the assessment.
    if(chunks.at(-1).length<5)chunks[chunks.length-1].push(...rotated.slice(0,5-chunks.at(-1).length));
    return chunks;
  });
}

// Recheck replacements against their duplicate counterparts and assigned theme.
// Unchanged, already-assessed reviews are context, never a fresh repair quota.
export function repairVerificationChunks(reviews,ids,diagnostics={}){
  const selectedIds=new Set(ids),targets=reviews.filter(review=>selectedIds.has(review.id)),chunks=[];
  for(let offset=0;offset<targets.length;offset+=PDP_REPAIR_BATCH_SIZE){
    const selected=targets.slice(offset,offset+PDP_REPAIR_BATCH_SIZE),wanted=new Set(selected.map(review=>review.id));
    const duplicateGroups=[...(diagnostics.exactDuplicateGroups||[]),...(diagnostics.materialDuplicateGroups||[])];
    const related=new Set([...(diagnostics.materialIssues||[]).filter(issue=>wanted.has(issue.id)||issue.relatedIds?.some(id=>wanted.has(id))).flatMap(issue=>[issue.id,...issue.relatedIds]),...duplicateGroups.filter(group=>group.some(id=>wanted.has(id))).flat()]);
    const themes=new Set(selected.map(review=>review.blueprint?.themeId).filter(Boolean)),others=reviews.filter(review=>!wanted.has(review.id));
    const context=[...others.filter(review=>related.has(review.id)),...others.filter(review=>!related.has(review.id)&&themes.has(review.blueprint?.themeId)),...others.filter(review=>!related.has(review.id)&&!themes.has(review.blueprint?.themeId))].slice(0,PDP_QA_CHUNK_SIZE-selected.length);
    chunks.push({reviews:[...selected,...context],assessmentIds:[...wanted]});
  }
  return chunks;
}
function mergeDiagnostics(parts,global,reviews,eligibleIds){
  const materialIssues=parts.flatMap(part=>part.materialIssues||[]),base={...global,materialIssues};
  const recommendedRepairIds=pdpRepairIds(base,reviews,{eligibleIds});
  const weighted=parts.reduce((sum,part)=>sum+Number(part.overallDiversityScore)*Number(part.count),0),weight=parts.reduce((sum,part)=>sum+Number(part.count),0);
  return{
    count:reviews.length,policyVersion:PDP_QUALITY_POLICY,exactUnique:global.uniqueBodies,
    exactDuplicateGroups:global.exactDuplicateGroups.map(group=>group.ids),duplicateTitleGroups:global.duplicateTitleGroups.map(group=>group.ids),
    lexicalNearDuplicatePairs:global.lexicalNearDuplicatePairs,repeatedOpenings:global.repeatedOpenings,
    materialDuplicateGroups:global.materialDuplicateGroups,materialIssues,recommendedRepairIds,overallDiversityScore:Math.round(weighted/Math.max(1,weight)),
    semanticNearDuplicateGroups:materialIssues.filter(issue=>issue.kind==='repetitive').map(issue=>({ids:[issue.id,...issue.relatedIds],similarity:issue.confidence,reason:issue.reason})),
    topics:[],structuralPatterns:[],nearDuplicateTitles:[],
    chunkedAssessment:{chunkSize:PDP_QA_CHUNK_SIZE,chunks:parts.length,passes:eligibleIds?1:reviews.length<=50?1:2,targeted:Boolean(eligibleIds),scores:parts.map(part=>part.overallDiversityScore),recommendedRepairIdCount:recommendedRepairIds.length},
  };
}

export async function advanceLargePdpQuality({run, origin, input, result, postJson, updateRun}) {
  const reviews=result.reviews,quality=qualityState(result.pdpQuality);
  const save=(next,message,step='qa')=>updateRun(run.id,{status:'running',error:null,current_step:step,progress_message:message,result_json:next});
  if(quality.phase==='blocked')throw Error(`PDP quality review is required: ${quality.remainingRepairIds.length} reviews still have material defects after ${quality.repairRounds} rounds. Saved reviews are available for inspection.`);
  if(quality.phase==='repair'){
    const offset=quality.repairOffset||0,ids=quality.remainingRepairIds.slice(offset,offset+PDP_REPAIR_BATCH_SIZE);
    if(!ids.length)throw Error('Corpus repair state is missing review IDs.');
    const subset=repairVerificationChunks(reviews,ids,result.corpusDiagnostics)[0].reviews;
    const repaired=await postJson(origin,'/api/corpus-qa',{mode:'repair',productTitle:input.productTitle,productDescription:input.productDescription,reviews:subset.map(qualityReview),repairIds:ids,repairDiagnostics:{materialIssues:result.corpusDiagnostics?.materialIssues||[],duplicateGroups:[...(result.corpusDiagnostics?.exactDuplicateGroups||[]),...(result.corpusDiagnostics?.materialDuplicateGroups||[])].filter(group=>group.some(id=>ids.includes(id)))}});
    const merged=mergePdpRepairs(subset,repaired,ids),byId=new Map(merged.reviews.map(review=>[review.id,review])),nextOffset=offset+ids.length,done=nextOffset>=quality.remainingRepairIds.length;
    const nextQuality=done?{phase:'assess',policyVersion:PDP_QUALITY_POLICY,repairRounds:quality.repairRounds+1,verificationIds:quality.remainingRepairIds}:{...quality,repairOffset:nextOffset};
    return save({...result,reviews:reviews.map(review=>byId.get(review.id)||review),corpusRepairCount:(result.corpusRepairCount||0)+merged.repairCount,pdpQuality:nextQuality,corpusDiagnostics:{...result.corpusDiagnostics,qaStatus:'repair_pending_recheck'}},done?'Repairs saved. Checking the replacements…':`Repaired ${nextOffset}/${quality.remainingRepairIds.length} material defects in round ${quality.repairRounds+1}/${PDP_MAX_REPAIR_ROUNDS}.`,done?'qa':'repair');
  }
  const verificationIds=quality.verificationIds,chunks=verificationIds?repairVerificationChunks(reviews,verificationIds,result.corpusDiagnostics):largeAssessmentChunks(reviews,quality.repairRounds).map(chunk=>({reviews:chunk,assessmentIds:chunk.map(review=>review.id)}));
  const offset=quality.assessmentOffset||0,chunk=chunks[offset];
  if(!chunk)throw Error('Corpus QA checkpoint has no assessment batch.');
  const qa=await postJson(origin,'/api/corpus-qa',{mode:'assess',productTitle:input.productTitle,productDescription:input.productDescription,reviews:chunk.reviews.map(qualityReview),assessmentIds:chunk.assessmentIds});
  if(Number(qa.diagnostics?.count)!==chunk.reviews.length||qa.diagnostics?.policyVersion!==PDP_QUALITY_POLICY||!Array.isArray(qa.diagnostics?.materialIssues)||!Number.isFinite(Number(qa.diagnostics?.overallDiversityScore)))throw Error('Corpus QA returned an incomplete material assessment.');
  const parts=[...(quality.assessments||[]),qa.diagnostics];
  if(offset+1<chunks.length)return save({...result,pdpQuality:{...quality,assessmentOffset:offset+1,assessments:parts}},`Assessed ${offset+1}/${chunks.length} ${verificationIds?'replacement':'material-quality'} QA batches.`);
  const global=corpusQualitySignals(reviews),diagnostics=mergeDiagnostics(parts,global,reviews,verificationIds),ids=diagnostics.recommendedRepairIds,phase=ids.length?(quality.repairRounds<PDP_MAX_REPAIR_ROUNDS?'repair':'blocked'):'passed';
  diagnostics.qaStatus=phase==='passed'?'server_completed':phase==='blocked'?'needs_review':'repair_required';
  return save({...result,pdpQuality:{phase,policyVersion:PDP_QUALITY_POLICY,repairRounds:quality.repairRounds,remainingRepairIds:ids,repairOffset:0},corpusDiagnostics:diagnostics,diagnostics:{uniqueBodies:global.uniqueBodies,uniqueTitles:global.uniqueTitles,uniquePersonaProfiles:new Set(reviews.map(review=>review.personaId)).size}},phase==='passed'?'Material quality checks passed. Ready to finalize.':`QA identified ${ids.length} reviews with material defects for ${phase==='blocked'?'manual review':'repair'}.`,phase==='passed'?'finalize':phase==='blocked'?'quality_review_required':'repair');
}

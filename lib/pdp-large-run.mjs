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
  // Mixed corpus order checks broad saturation; theme order compares related
  // scenarios generated in distant batches. Every review is judged in both.
  const themeOrder=[...reviews].sort((a,b)=>String(a.blueprint?.themeId||'').localeCompare(String(b.blueprint?.themeId||''))||String(a.id).localeCompare(String(b.id)));
  return [reviews,themeOrder].flatMap((order,pass)=>{
    const shift=(round*13+pass*7)%order.length,rotated=[...order.slice(shift),...order.slice(0,shift)],chunks=[];
    for(let i=0;i<rotated.length;i+=PDP_QA_CHUNK_SIZE)chunks.push(rotated.slice(i,i+PDP_QA_CHUNK_SIZE));
    // The assessor needs at least five reviews. Pad the final short chunk
    // with earlier context, retaining every original ID in the assessment.
    if(chunks.at(-1).length<5)chunks[chunks.length-1].push(...rotated.slice(0,5-chunks.at(-1).length));
    return chunks;
  });
}

function compact(review){return{id:review.id,rating:review.rating,title:review.title,body:review.body}}
function mergeDiagnostics(parts,global,reviews){
  const recommendedRepairIds=[...new Set([...global.repairIds,...parts.flatMap(part=>pdpRepairIds(part,reviews))])];
  const scores=parts.map(part=>Number(part.overallDiversityScore));
  return{
    count:reviews.length,exactUnique:global.uniqueBodies,
    exactDuplicateGroups:global.exactDuplicateGroups.map(group=>group.ids),duplicateTitleGroups:global.duplicateTitleGroups.map(group=>group.ids),
    lexicalNearDuplicatePairs:global.lexicalNearDuplicatePairs,repeatedOpenings:global.repeatedOpenings,
    recommendedRepairIds,overallDiversityScore:Math.min(...scores),
    // Bound presentation details, never the actionable repair ID set.
    semanticNearDuplicateGroups:parts.flatMap(part=>part.semanticNearDuplicateGroups||[]).slice(0,60),
    nearDuplicateTitles:parts.flatMap(part=>part.nearDuplicateTitles||[]).slice(0,60),
    structuralPatterns:parts.flatMap(part=>part.structuralPatterns||[]).slice(0,40),
    topics:parts.flatMap(part=>part.topics||[]).slice(0,40),
    semanticNearDuplicatePairs:parts.reduce((n,part)=>n+(Number(part.semanticNearDuplicatePairs)||0),0),
    repeatedTitleCount:new Set([...global.duplicateTitleGroups.flatMap(group=>group.ids),...parts.flatMap(part=>(part.nearDuplicateTitles||[]).flatMap(group=>group.ids))]).size,
    chunkedAssessment:{chunkSize:PDP_QA_CHUNK_SIZE,chunks:parts.length,passes:2,scores,recommendedRepairIdCount:recommendedRepairIds.length},
  };
}

export async function advanceLargePdpQuality({run, origin, input, result, postJson, updateRun}) {
  const reviews=result.reviews,quality=result.pdpQuality||{phase:'assess',repairRounds:0};
  const save=(next,message,step='qa')=>updateRun(run.id,{status:'running',current_step:step,progress_message:message,result_json:next});
  if(quality.phase==='blocked')throw Error(`PDP quality review is required: ${quality.remainingRepairIds.length} reviews still need repair after ${quality.repairRounds} rounds. Saved reviews are available for inspection.`);
  if(quality.phase==='repair'){
    const offset=quality.repairOffset||0,ids=quality.remainingRepairIds.slice(offset,offset+PDP_REPAIR_BATCH_SIZE),wanted=new Set(ids);
    if(!ids.length)throw Error('Large corpus repair state is missing review IDs.');
    const selected=reviews.filter(review=>wanted.has(review.id));
    const related=new Set([...(result.corpusDiagnostics?.semanticNearDuplicateGroups||[]),...(result.corpusDiagnostics?.nearDuplicateTitles||[])].filter(group=>group.ids.some(id=>wanted.has(id))).flatMap(group=>group.ids));
    const others=reviews.filter(review=>!wanted.has(review.id));
    const context=[...others.filter(review=>related.has(review.id)),...others.filter(review=>!related.has(review.id))].slice(0,PDP_QA_CHUNK_SIZE-selected.length);
    const subset=[...selected,...context],diagnostics=result.corpusDiagnostics||{};
    const repaired=await postJson(origin,'/api/corpus-qa',{mode:'repair',productTitle:input.productTitle,productDescription:input.productDescription,reviews:subset.map(compact),repairIds:ids,repairDiagnostics:{overallDiversityScore:diagnostics.overallDiversityScore,recommendedRepairIds:ids,topics:diagnostics.topics,structuralPatterns:diagnostics.structuralPatterns,semanticNearDuplicateGroups:diagnostics.semanticNearDuplicateGroups,nearDuplicateTitles:diagnostics.nearDuplicateTitles}});
    const merged=mergePdpRepairs(subset,repaired,ids),byId=new Map(merged.reviews.map(review=>[review.id,review])),nextOffset=offset+ids.length,done=nextOffset>=quality.remainingRepairIds.length;
    const nextQuality=done?{phase:'assess',repairRounds:quality.repairRounds+1}:{...quality,repairOffset:nextOffset};
    return save({...result,reviews:reviews.map(review=>byId.get(review.id)||review),corpusRepairCount:(result.corpusRepairCount||0)+merged.repairCount,pdpQuality:nextQuality,corpusDiagnostics:{...diagnostics,qaStatus:'repair_pending_recheck'}},done?'Repair round saved. Rechecking the entire corpus…':`Repaired ${nextOffset}/${quality.remainingRepairIds.length} flagged reviews in round ${quality.repairRounds+1}/${PDP_MAX_REPAIR_ROUNDS}.`,done?'qa':'repair');
  }
  const chunks=largeAssessmentChunks(reviews,quality.repairRounds),offset=quality.assessmentOffset||0,chunk=chunks[offset];
  const qa=await postJson(origin,'/api/corpus-qa',{mode:'assess',productTitle:input.productTitle,productDescription:input.productDescription,reviews:chunk.map(compact)});
  if(Number(qa.diagnostics?.count)!==chunk.length||!Array.isArray(qa.diagnostics?.recommendedRepairIds)||!Number.isFinite(Number(qa.diagnostics?.overallDiversityScore)))throw Error('Corpus QA returned an incomplete assessment.');
  const parts=[...(quality.assessments||[]),qa.diagnostics];
  if(offset+1<chunks.length)return save({...result,pdpQuality:{...quality,assessmentOffset:offset+1,assessments:parts}},`Assessed ${offset+1}/${chunks.length} QA batches (round ${quality.repairRounds+1}).`);
  const global=corpusQualitySignals(reviews),diagnostics=mergeDiagnostics(parts,global,reviews),ids=diagnostics.recommendedRepairIds,phase=ids.length?(quality.repairRounds<PDP_MAX_REPAIR_ROUNDS?'repair':'blocked'):'passed';
  diagnostics.qaStatus=phase==='passed'?'server_completed':phase==='blocked'?'needs_review':'repair_required';
  return save({...result,pdpQuality:{phase,repairRounds:quality.repairRounds,remainingRepairIds:ids,repairOffset:0},corpusDiagnostics:diagnostics,diagnostics:{uniqueBodies:global.uniqueBodies,uniqueTitles:global.uniqueTitles,uniquePersonaProfiles:new Set(reviews.map(review=>review.personaId)).size}},phase==='passed'?'QA passed. Ready to finalize.':`QA identified ${ids.length} reviews for ${phase==='blocked'?'manual review':'repair'}.`,phase==='passed'?'finalize':phase==='blocked'?'quality_review_required':'repair');
}

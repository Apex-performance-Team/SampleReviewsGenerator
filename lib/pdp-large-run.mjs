import {createBlueprintPlan, requestedThemeCount, sanitizeThemes, corpusQualitySignals} from './review-blueprint.mjs';
import {PDP_QA_CHUNK_SIZE} from './review-limits.mjs';
import {PDP_MAX_REPAIR_ROUNDS, PDP_REPAIR_BATCH_SIZE, pdpRepairIds, mergePdpRepairs} from './pdp-corpus-repair.mjs';

// Large plans are assembled across durable steps; never ask one model call
// to emit hundreds of themes or thousands of assignments.
export async function advanceLargePdpPlan({run, origin, input, result, postJson, updateRun}) {
  const planning=result.pdpPlanning||{themes:[],batches:[]},total=requestedThemeCount(run.requested_count);
  if(planning.themes.length<total){
    const count=Math.min(50,total-planning.themes.length);
    const part=await postJson(origin,'/api/generation-plan',{
      ...input,reviewCount:Math.max(5,count*4),targetAverage:Number(input.targetAverage)||4.7,
      externalReferencesEnabled:false,previousThemes:planning.themes.map(theme=>theme.focus),
    });
    if(part.plannerFallbackReason)throw Error('Large PDP planning needs a usable model response: '+part.plannerFallbackReason);
    const themes=sanitizeThemes([...planning.themes,...(part.themes||[]).slice(0,count)],{minimum:planning.themes.length+count,maximum:total});
    return updateRun(run.id,{status:'running',current_step:'plan',progress_message:`Planned ${themes.length}/${total} PDP themes.`,result_json:{...result,pdpPlanning:{themes,batches:[...planning.batches,{model:part.plannerModel,provider:part.plannerProvider}]}}});
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

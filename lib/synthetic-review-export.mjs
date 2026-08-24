export const SYNTHETIC_REVIEW_HEADERS=[
  'synthetic_fixture','publication_allowed','fixture_type','dataset_purpose',
  'product_title','product_url','run_id','plan_id','generated_at','generation_model','planner_model',
  'requested_review_count','target_average','actual_average','rating_distribution','reference_available','reference_led_total','pdp_only_total','generation_ai_calls_attempted','generation_ai_calls_expected','generation_ai_calls_cap','corpus_qa_status','corpus_diversity_score','corpus_repair_count','theme_count','max_theme_use','rating_compatibility_fallback',
  'id','rating','title','body','fixture_date',
  'persona_id','persona_label','persona_voice','persona_structure','persona_texture','persona_length_band','persona_min_words','persona_max_words',
  'theme_id','scenario_id','theme_focus','theme_scenario','theme_evidence_boundary','narrative_shape',
  'reference_led','reference_role','reference_id','reference_platform','reference_provider','reference_source_url','reference_rating','reference_lane_id','reference_lane_label','reference_stage','reference_context','reference_job','reference_outcome','reference_story_family_id','reference_story_family_label','reference_cluster_id','reference_cluster_label',
  'plausibility_action','plausibility_flags','diversity_repaired','diversity_repair_reasons',
];

function cell(value){const normalized=value==null?'':typeof value==='object'?JSON.stringify(value):String(value),safe=/^[=+\-@]/.test(normalized)?`'${normalized}`:normalized;return`"${safe.replace(/"/g,'""')}"`}
function slug(value){return String(value||'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'product'}

function reviewRow({result,review,productTitle,productUrl}){
  const profile=review?.personaProfile||{},blueprint=review?.blueprint||{},qa=result?.corpusDiagnostics||{},plan=result?.planDiagnostics||{},input=result?.input||{},calls=result?.generationCallBudget||{},coverage=result?.referenceCoverage||{};
  return{
    synthetic_fixture:true,publication_allowed:false,fixture_type:review?.fixtureType||'synthetic_review_qa',dataset_purpose:result?.datasetPurpose||'internal_qa_modeling',
    product_title:productTitle||input.productTitle||'',product_url:productUrl||input.productUrl||'',run_id:result?.runId||'',plan_id:result?.planId||'',generated_at:result?.planGeneratedAt||'',generation_model:result?.model||'',planner_model:result?.plannerModel||'',
    requested_review_count:input.reviewCount??result?.reviewCount??'',target_average:input.targetAverage??result?.targetAverage??'',actual_average:result?.actualAverage??'',rating_distribution:result?.distribution||{},reference_available:coverage.available??'',reference_led_total:coverage.referenceLedTotal??plan.referenceLedTotal??'',pdp_only_total:coverage.pdpOnlyTotal??'',generation_ai_calls_attempted:calls.aiCallsAttempted??'',generation_ai_calls_expected:calls.expected??'',generation_ai_calls_cap:calls.capped??'',corpus_qa_status:qa.qaStatus||'',corpus_diversity_score:qa.overallDiversityScore??'',corpus_repair_count:result?.corpusRepairCount??0,theme_count:plan.themeCount??'',max_theme_use:plan.maxThemeUse??'',rating_compatibility_fallback:Boolean(plan.ratingCompatibilityFallback),
    id:review?.id||'',rating:review?.rating??'',title:review?.title||'',body:review?.body||'',fixture_date:review?.date||'',
    persona_id:review?.personaId||'',persona_label:review?.persona||profile.label||'',persona_voice:profile.voice||'',persona_structure:profile.structure||'',persona_texture:profile.texture||'',persona_length_band:profile.lengthBand||'',persona_min_words:profile.minWords??'',persona_max_words:profile.maxWords??'',
    theme_id:blueprint.themeId||'',scenario_id:blueprint.scenarioId||'',theme_focus:blueprint.focus||'',theme_scenario:blueprint.scenario||'',theme_evidence_boundary:blueprint.evidenceBoundary||'',narrative_shape:blueprint.narrativeShape||'',
    reference_led:Boolean(review?.referenceLed),reference_role:review?.referenceRole||'',reference_id:review?.referenceId||'',reference_platform:review?.referencePlatform||'',reference_provider:review?.referenceProvider||'',reference_source_url:review?.referenceSourceUrl||'',reference_rating:review?.referenceRating??'',reference_lane_id:review?.referenceLaneId||review?.referenceFingerprint?.laneId||'',reference_lane_label:review?.referenceLaneLabel||review?.referenceFingerprint?.laneLabel||'',reference_stage:review?.referenceStage||review?.referenceFingerprint?.stage?.label||'',reference_context:review?.referenceContext||review?.referenceFingerprint?.context?.label||'',reference_job:review?.referenceJob||review?.referenceFingerprint?.job?.label||'',reference_outcome:review?.referenceOutcome||review?.referenceFingerprint?.outcome?.label||'',reference_story_family_id:review?.referenceStoryFamilyId||'',reference_story_family_label:review?.referenceStoryFamilyLabel||'',reference_cluster_id:review?.referenceClusterId||'',reference_cluster_label:review?.referenceClusterLabel||'',
    plausibility_action:review?.plausibilityAction||'',plausibility_flags:review?.plausibilityFlags||[],diversity_repaired:Boolean(review?.diversityRepaired),diversity_repair_reasons:review?.diversityRepairReasons||[],
  };
}

function encode(rows){return'\ufeff'+[SYNTHETIC_REVIEW_HEADERS.map(cell).join(','),...rows.map(row=>SYNTHETIC_REVIEW_HEADERS.map(header=>cell(row[header])).join(','))].join('\r\n')}

export function syntheticReviewCsv(result){return encode((result?.reviews||[]).map(review=>reviewRow({result,review})))}

export function syntheticReviewBulkCsv(bulkResult){
  const rows=[];
  for(const product of bulkResult?.products||[])for(const review of product?.reviews||[])rows.push(reviewRow({result:{...product,runId:product.runId||bulkResult?.runId,planId:product.planId,plannerModel:product.plannerModel,datasetPurpose:bulkResult?.datasetPurpose},review,productTitle:product.productTitle,productUrl:product.productUrl}));
  return encode(rows);
}

export function syntheticReviewFilename(result,{bulk=false}={}){const title=bulk?'shopify-catalog':result?.input?.productTitle||result?.productTitle||'product';return`synthetic-review-qa-${slug(title)}-${new Date().toISOString().slice(0,10)}.csv`}

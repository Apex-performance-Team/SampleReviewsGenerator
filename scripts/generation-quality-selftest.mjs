import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{corpusQualitySignals,createBlueprintPlan,createPersonaProfiles,requestedThemeCount,sanitizePlanItems,solveNaturalRatingDistribution}from'../lib/review-blueprint.mjs';
import{generationFailureAudit,quarantineFailedReviews,reviewRatingSummary}from'../lib/review-quality-finalize.mjs';
import{SYNTHETIC_REVIEW_HEADERS,syntheticReviewCsv}from'../lib/synthetic-review-export.mjs';

const solved=solveNaturalRatingDistribution(100,4.7);
assert.deepEqual(solved.by,{1:2,2:2,3:3,4:10,5:83});
assert.equal(solved.avg,4.7);
for(const n of[5,17,50,100,250])for(const target of[1,1.3,2,3,4,4.7,4.9,5])assert.equal(solveNaturalRatingDistribution(n,target).avg,Math.round(n*target)/n);

const profiles=createPersonaProfiles(250,'selftest');
assert.equal(profiles.length,250);
assert.equal(new Set(profiles.map(x=>x.signature)).size,250);
assert(!profiles.some(profile=>/\b(verdict|caveat|overall|tradeoff|final judgment|final judgement)\b/i.test(profile.signature)));

const themes=Array.from({length:25},(_,index)=>({id:`THEME-${String(index+1).padStart(2,'0')}`,focus:`Distinct product focus ${index+1}`,scenarioVariants:Array.from({length:4},(__,variant)=>`Scenario ${index+1}.${variant+1}`),evidenceBoundary:`Do not exceed evidence boundary ${index+1}`,allowedRatings:[1,2,3,4,5]}));
const now=Date.UTC(2030,4,27),references=Array.from({length:20},(_,index)=>({referenceId:`REF-${index+1}`,sourceRating:index%5+1,sourceUrl:index<12?'https://example.com/products/high-volume':'https://example.com/products/lower-volume',sourceTitle:`Reference title ${index+1}`,sourceBody:`Reference body ${index+1} contains a distinct enough customer experience for assignment testing.`})),plan=createBlueprintPlan({productTitle:'Test product',productDescription:'Authoritative context',reviewCount:100,targetAverage:4.7,themes,references,now,nonce:'selftest'});
assert.equal(plan.items.length,100);
assert.equal(plan.actualAverage,4.7);
assert.equal(plan.diagnostics.uniquePersonaProfiles,100);
assert.equal(plan.diagnostics.themeCount,25);
assert.equal(plan.diagnostics.minThemeUse,4);
assert.equal(plan.diagnostics.maxThemeUse,4);
assert.equal(plan.diagnostics.uniqueScenarios,100);
assert.equal(plan.diagnostics.ratingCompatibilityFallback,false);
assert.equal(plan.diagnostics.referenceLedTotal,20);
assert.equal(new Set(plan.items.filter(x=>x.referenceId).map(x=>x.referenceId)).size,20);
assert(plan.items.every(x=>x.date<='2030-05-27'&&x.date>='2029-05-28'));
assert.equal(sanitizePlanItems(plan.items.slice(0,10),{maximum:10,reviewCount:100}).length,10);
assert.equal(sanitizePlanItems([{...plan.items[0],blueprint:{...plan.items[0].blueprint,scenarioId:''}}],{maximum:10,reviewCount:100}).length,0);

const largeThemes=Array.from({length:63},(_,index)=>({id:`MODEL-ID-${index%3}`,focus:`Large-plan focus ${index+1}`,scenarioVariants:Array.from({length:4},(__,variant)=>`Large scenario ${index+1}.${variant+1}`),evidenceBoundary:'Stay within supplied context.',allowedRatings:index<60?[5]:[1,2,3,4,5]})),largePlan=createBlueprintPlan({productTitle:'Large test product',productDescription:'Context',reviewCount:250,targetAverage:4.7,themes:largeThemes,now,nonce:'large'});
assert.equal(largePlan.items.length,250);
assert.equal(largePlan.diagnostics.themeCount,63);
assert.equal(largePlan.diagnostics.minThemeUse,3);
assert.equal(largePlan.diagnostics.maxThemeUse,4);
assert.equal(largePlan.diagnostics.uniqueScenarios,250);
assert.equal(largePlan.diagnostics.ratingCompatibilityFallback,true);
assert.equal(new Set(largePlan.items.map(x=>x.blueprint.themeId)).size,63);

for(const count of[5,12,13,48,49,100,249,250])for(const average of[1,3,4.7,5]){
  const themeTotal=requestedThemeCount(count),matrixThemes=Array.from({length:themeTotal},(_,index)=>({focus:`Matrix focus ${index+1}`,scenarioVariants:[1,2,3,4].map(variant=>`Matrix scenario ${index+1}.${variant}`),allowedRatings:[1,2,3,4,5]})),matrixPlan=createBlueprintPlan({productTitle:'Matrix product',productDescription:'Context',reviewCount:count,targetAverage:average,themes:matrixThemes,now,nonce:`${count}-${average}`});
  assert.equal(matrixPlan.items.length,count);assert(matrixPlan.diagnostics.maxThemeUse<=4);assert.equal(matrixPlan.diagnostics.uniqueScenarios,count);
}

const repetitive=[
  {id:'SYN-0001',title:'Simple and effective',body:'Easy connection, quick channel scan, and clear local channels. No Wi-Fi needed.'},
  {id:'SYN-0002',title:'Simple and effective',body:'Easy connection, quick channel scan, and clear local TV. No monthly fee needed.'},
  {id:'SYN-0003',title:'Local TV without hassle',body:'I connected it to the coax input, ran the channel scan, and watched local broadcasts within minutes.'},
  {id:'SYN-0004',title:'Local TV without extra hassle',body:'I connected it to the coax input, ran the channel scan, and watched local broadcasts shortly afterward.'},
  {id:'SYN-0005',title:'Placement experiment',body:'The first position was inconsistent, but moving the antenna near a window gave the main stations a steadier picture.'},
];
const repetitiveSignals=corpusQualitySignals(repetitive);
assert.equal(repetitiveSignals.passed,false);
assert(repetitiveSignals.repairIds.includes('SYN-0002'));
assert(repetitiveSignals.repairIds.includes('SYN-0004'));

const diverse=[
  {id:'SYN-0001',title:'Fits neatly beside the television',body:'The low-profile shape works well in a room where I did not want another bulky device on display.'},
  {id:'SYN-0002',title:'Instructions answered my setup question',body:'The included directions made the input selection clear, so the first installation did not involve much guessing.'},
  {id:'SYN-0003',title:'Useful during an internet outage',body:'When streaming was unavailable, I still had a practical way to check the local weather broadcast.'},
  {id:'SYN-0004',title:'A reasonable option for the guest room',body:'I only use that television occasionally, and this covers the basic viewing I wanted without another recurring service.'},
  {id:'SYN-0005',title:'One limitation was worth noting',body:'A weaker station remained inconsistent in the center of my building, even though the stronger broadcasts stayed watchable.'},
];
assert.equal(corpusQualitySignals(diverse).passed,true);

const purgeInput=Array.from({length:50},(_,index)=>({id:`SYN-${String(index+1).padStart(4,'0')}`,rating:index<42?5:index<46?4:index<48?3:index===48?2:1,title:`Purge fixture ${index+1}`,body:`Distinct purge behavior validation body number ${index+1}.`})),purged=quarantineFailedReviews(purgeInput,{deterministicDiagnostics:{repairIds:['SYN-0008'],repairReasons:{'SYN-0008':['lexical_near_duplicate']}},semanticRepairIds:['SYN-0017'],semanticRepairReasons:{'SYN-0017':['semantic_near_duplicate with SYN-0016']}});
assert.equal(purged.generatedReviewCount,50);
assert.equal(purged.finalReviewCount,48);
assert.equal(purged.purgedReviewCount,2);
assert.deepEqual(purged.purgedReviewIds,['SYN-0008','SYN-0017']);
assert(!purged.reviews.some(review=>purged.purgedReviewIds.includes(review.id)));
assert(purged.purgedReviews.every(review=>review.excludedFromFinalOutput&&review.qualityPurgeReasons.length));
assert.deepEqual(reviewRatingSummary(purged.reviews).distribution,{1:1,2:1,3:2,4:4,5:40});
assert.equal(purged.actualAverage,225/48);

const failedGenerationAudit=generationFailureAudit([{batchIndex:2,error:'provider timeout',items:plan.items.slice(20,30)}]);
assert.equal(failedGenerationAudit.length,10);
assert.equal(failedGenerationAudit[0].id,'SYN-0021');
assert.equal(failedGenerationAudit[0].generationFailureBatch,3);
assert.equal(failedGenerationAudit[0].excludedFromFinalOutput,true);
assert.match(failedGenerationAudit[0].qualityPurgeReasons[0],/provider timeout/);

const reviews=plan.items.map((item,index)=>({...item,title:index===0?'=formula-like title':`Export fixture ${index+1}`,body:`Synthetic QA export validation body ${index+1} with enough distinct text for this fixture.`,referenceLed:index===0,referenceId:index===0?'REF-1':null,referencePlatform:index===0?'example.com':null,referenceProvider:index===0?'test':null,referenceSourceUrl:index===0?'https://example.com/review/1':null,referenceRating:index===0?5:null,plausibilityAction:'self_audited',plausibilityFlags:[],fixtureType:'synthetic_review_qa'})),result={input:{productTitle:'Test product',productUrl:'https://example.com/products/test',reviewCount:100,targetAverage:4.7},runId:plan.runId,planId:plan.planId,planGeneratedAt:plan.generatedAt,distribution:plan.distribution,actualAverage:plan.actualAverage,planDiagnostics:plan.diagnostics,referenceCoverage:{available:20,referenceLedTotal:1,pdpOnlyTotal:99,scope:'dataset'},generationCallBudget:{aiCallsAttempted:12,expected:12,capped:17},model:'test-model',plannerModel:'test-planner',datasetPurpose:'internal_qa_modeling',corpusDiagnostics:{qaStatus:'completed',overallDiversityScore:94},reviews},csv=syntheticReviewCsv(result);
assert.equal(csv.split('\r\n').length,101);
for(const header of['product_title','product_url','run_id','plan_id','requested_review_count','generated_review_count','final_review_count','purged_review_count','purged_review_ids','reference_available','reference_led_total','pdp_only_total','generation_ai_calls_attempted','persona_voice','scenario_id','theme_focus','reference_id','corpus_qa_status','style_action','style_flags'])assert(SYNTHETIC_REVIEW_HEADERS.includes(header));
assert(csv.includes('https://example.com/products/test'));
assert(csv.includes('https://example.com/review/1'));
assert(csv.includes('publication_allowed'));
assert(csv.includes("'=formula-like title"));

const purgeCsv=syntheticReviewCsv({...result,reviews:purged.reviews,purgedReviews:purged.purgedReviews,generatedReviewCount:purged.generatedReviewCount,finalReviewCount:purged.finalReviewCount,purgedReviewCount:purged.purgedReviewCount,distribution:purged.distribution,originalDistribution:plan.distribution,actualAverage:purged.actualAverage,corpusDiagnostics:{qaStatus:'completed_with_purge',overallDiversityScore:81}});
assert.equal(purgeCsv.split('\r\n').length,49);
assert(!purgeCsv.includes('Distinct purge behavior validation body number 8.'));
assert(!purgeCsv.includes('Distinct purge behavior validation body number 17.'));
assert(purgeCsv.includes('SYN-0008'));
assert(purgeCsv.includes('completed_with_purge'));

const sourceFirstRefs=[...Array.from({length:12},(_,index)=>({referenceId:`LOW-${index+1}`,sourceRating:5,sourceUrl:'https://www.amazon.com/dp/B000000001',sourcePublicReviewCount:100,sourceTitle:`Low source ${index+1}`,sourceBody:`Lower source review ${index+1} has enough individual customer text to be eligible.`})),...Array.from({length:12},(_,index)=>({referenceId:`HIGH-${index+1}`,sourceRating:5,sourceUrl:'https://www.amazon.com/dp/B000000002',sourcePublicReviewCount:900,sourceTitle:`High source ${index+1}`,sourceBody:`Higher source review ${index+1} has enough individual customer text to be eligible.`}))],sourceFirstPlan=createBlueprintPlan({productTitle:'Source priority product',productDescription:'Context',reviewCount:10,targetAverage:5,themes,references:sourceFirstRefs,now,nonce:'source-first'});
assert.equal(sourceFirstPlan.diagnostics.referenceLedTotal,10);
assert.equal(sourceFirstPlan.diagnostics.referencePrimarySourceKey,'https://amazon.com/dp/B000000002');
assert(sourceFirstPlan.items.filter(x=>x.referenceId).every(x=>String(x.referenceId).startsWith('HIGH-')));

const roleCapThemes=Array.from({length:50},(_,index)=>({id:`ROLE-THEME-${index+1}`,focus:`Role cap focus ${index+1}`,scenarioVariants:Array.from({length:4},(__,variant)=>`Role cap scenario ${index+1}.${variant+1}`),evidenceBoundary:'Stay within supplied context.',allowedRatings:[1,2,3,4,5]})),sameFamilyRefs=Array.from({length:200},(_,index)=>({referenceId:`FAMILY-${index+1}`,sourceRating:5,sourceUrl:'https://www.amazon.com/dp/B000000099',sourcePublicReviewCount:1000,sourceTitle:`Family reference ${index+1}`,sourceBody:`Easy setup and strong reception after placement adjustment for family reference ${index+1}.`})),roleCapPlan=createBlueprintPlan({productTitle:'Large role cap product',productDescription:'Context',reviewCount:200,targetAverage:4.7,themes:roleCapThemes,references:sameFamilyRefs,now,nonce:'role-cap'});
assert.equal(roleCapPlan.diagnostics.referenceLedTotal,200);
assert.equal(roleCapPlan.diagnostics.referenceRoleUsage.source_rewrite,1);
assert.equal(roleCapPlan.diagnostics.referenceRoleUsage.reference_supported_blueprint,199);

const imported50=Array.from({length:50},(_,index)=>({referenceId:`AMZ-${index+1}`,sourceRating:index%5+1,sourceUrl:'https://www.amazon.com/dp/B00MNV8E0C',sourceTitle:`Imported reference ${index+1}`,sourceBody:`Imported Amazon reference ${index+1} has enough unique source review text for CSV coverage testing.`})),plan50=createBlueprintPlan({productTitle:'Imported reference ratio product',productDescription:'Context',reviewCount:100,targetAverage:4.7,themes,references:imported50,now,nonce:'imported-50'});
assert.equal(plan50.diagnostics.referenceLedTotal,50);
assert.equal(plan50.items.filter(x=>x.referenceId).length,50);
assert.equal(plan50.items.filter(x=>!x.referenceId).length,50);
const reviews50=plan50.items.map((item,index)=>({...item,title:`Reference coverage fixture ${index+1}`,body:`Synthetic QA fixture ${index+1} for validating imported reference coverage in generated CSV exports.`,referenceLed:Boolean(item.referenceId),referenceId:item.referenceId,referencePlatform:item.referenceId?'amazon.com':null,referenceProvider:item.referenceId?'bright_data_amazon_reviews_v2':null,referenceSourceUrl:item.referenceId?'https://www.amazon.com/dp/B00MNV8E0C':null,referenceRating:item.referenceId?item.rating:null,plausibilityAction:'self_audited',plausibilityFlags:[],fixtureType:'synthetic_review_qa'})),csv50=syntheticReviewCsv({input:{productTitle:'Imported reference ratio product',productUrl:'https://example.com/products/imported-reference-ratio',reviewCount:100,targetAverage:4.7},runId:plan50.runId,planId:plan50.planId,planGeneratedAt:plan50.generatedAt,distribution:plan50.distribution,actualAverage:plan50.actualAverage,planDiagnostics:plan50.diagnostics,referenceCoverage:{available:50,referenceLedTotal:50,pdpOnlyTotal:50,scope:'dataset'},generationCallBudget:{aiCallsAttempted:12,expected:12,capped:17},model:'test-model',plannerModel:'test-planner',datasetPurpose:'internal_qa_modeling',corpusDiagnostics:{qaStatus:'completed',overallDiversityScore:94},reviews:reviews50});
assert.equal(csv50.split('\r\n').length,101);
assert.equal((csv50.match(/"AMZ-/g)||[]).length,50);
assert(csv50.includes('"50","50","50"'));

const generateRouteSource=readFileSync(new URL('../app/api/generate/route.js',import.meta.url),'utf8'),pageSource=readFileSync(new URL('../app/page.js',import.meta.url),'utf8');
assert.match(generateRouteSource,/if\(input\.generationMode==='blueprint_v2'\)return finalize\(styleGateLocally\(input,drafts\)\)/);
assert.match(generateRouteSource,/modelCalls:blueprintMode\?1:3/);
assert.match(pageSource,/failedBatches\.push\(/);
assert.match(pageSource,/generationFailureAudit\(generated\.failedBatches\)/);
assert(generateRouteSource.includes("HARD_LOCAL_STYLE_WARNINGS=new Set(['product_context_conflict','template_phrase','analysis_framing'])"));
assert(generateRouteSource.includes("styleAction:hardWarnings.length?'deferred_to_corpus_qa':warnings.length?'advisory':'pass'"));
assert(generateRouteSource.includes('local_hard_warnings:hardWarnings'));
assert(pageSource.includes("STYLE_REPAIR_CALL_CAP=1,DETERMINISTIC_REPAIR_CALL_CAP=1"));
assert(pageSource.includes("HARD_LOCAL_STYLE_FLAG_TYPES=new Set(['PRODUCT_CONTEXT_CONFLICT','TEMPLATE_PHRASE','ANALYSIS_FRAMING'])"));
assert(pageSource.includes("repairCallAllowance(budget,STYLE_REPAIR_CALL_CAP,2)*10"));
assert(pageSource.includes("repairCallAllowance(budget,DETERMINISTIC_REPAIR_CALL_CAP,1)*10"));

console.log('generation blueprint, diversity, rating, date, persona, and CSV self-tests passed');

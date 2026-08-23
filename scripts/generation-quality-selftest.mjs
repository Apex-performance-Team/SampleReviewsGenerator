import assert from'node:assert/strict';
import{corpusQualitySignals,createBlueprintPlan,createPersonaProfiles,requestedThemeCount,sanitizePlanItems,solveNaturalRatingDistribution}from'../lib/review-blueprint.mjs';
import{SYNTHETIC_REVIEW_HEADERS,syntheticReviewCsv}from'../lib/synthetic-review-export.mjs';

const solved=solveNaturalRatingDistribution(100,4.7);
assert.deepEqual(solved.by,{1:2,2:2,3:3,4:10,5:83});
assert.equal(solved.avg,4.7);
for(const n of[5,17,50,100,250])for(const target of[1,1.3,2,3,4,4.7,4.9,5])assert.equal(solveNaturalRatingDistribution(n,target).avg,Math.round(n*target)/n);

const profiles=createPersonaProfiles(250,'selftest');
assert.equal(profiles.length,250);
assert.equal(new Set(profiles.map(x=>x.signature)).size,250);

const themes=Array.from({length:25},(_,index)=>({id:`THEME-${String(index+1).padStart(2,'0')}`,focus:`Distinct product focus ${index+1}`,scenarioVariants:Array.from({length:4},(__,variant)=>`Scenario ${index+1}.${variant+1}`),evidenceBoundary:`Do not exceed evidence boundary ${index+1}`,allowedRatings:[1,2,3,4,5]}));
const now=Date.UTC(2030,4,27),references=Array.from({length:20},(_,index)=>({referenceId:`REF-${index+1}`,sourceRating:index%5+1})),plan=createBlueprintPlan({productTitle:'Test product',productDescription:'Authoritative context',reviewCount:100,targetAverage:4.7,themes,references,now,nonce:'selftest'});
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

const reviews=plan.items.map((item,index)=>({...item,title:index===0?'=formula-like title':`Export fixture ${index+1}`,body:`Synthetic QA export validation body ${index+1} with enough distinct text for this fixture.`,referenceLed:index===0,referenceId:index===0?'REF-1':null,referencePlatform:index===0?'example.com':null,referenceProvider:index===0?'test':null,referenceSourceUrl:index===0?'https://example.com/review/1':null,referenceRating:index===0?5:null,plausibilityAction:'self_audited',plausibilityFlags:[],fixtureType:'synthetic_review_qa'})),result={input:{productTitle:'Test product',productUrl:'https://example.com/products/test',reviewCount:100,targetAverage:4.7},runId:plan.runId,planId:plan.planId,planGeneratedAt:plan.generatedAt,distribution:plan.distribution,actualAverage:plan.actualAverage,planDiagnostics:plan.diagnostics,generationCallBudget:{aiCallsAttempted:12,expected:12,capped:17},model:'test-model',plannerModel:'test-planner',datasetPurpose:'internal_qa_modeling',corpusDiagnostics:{qaStatus:'completed',overallDiversityScore:94},reviews},csv=syntheticReviewCsv(result);
assert.equal(csv.split('\r\n').length,101);
for(const header of['product_title','product_url','run_id','plan_id','generation_ai_calls_attempted','persona_voice','scenario_id','theme_focus','reference_id','corpus_qa_status'])assert(SYNTHETIC_REVIEW_HEADERS.includes(header));
assert(csv.includes('https://example.com/products/test'));
assert(csv.includes('https://example.com/review/1'));
assert(csv.includes('publication_allowed'));
assert(csv.includes("'=formula-like title"));

console.log('generation blueprint, diversity, rating, date, persona, and CSV self-tests passed');

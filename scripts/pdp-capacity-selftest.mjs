import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as repair from '../lib/pdp-corpus-repair.mjs';
import * as large from '../lib/pdp-large-run.mjs';
import {solveNaturalRatingDistribution,createPersonaProfiles,corpusQualitySignals} from '../lib/review-blueprint.mjs';
import {reviewRatingSummary} from '../lib/review-quality-finalize.mjs';
import {buildCatalogResult} from '../lib/store-review-catalog.mjs';
import {resultPage,publicReviewRun,streamText} from '../lib/review-result-pages.mjs';
import {syntheticReviewCsv} from '../lib/synthetic-review-export.mjs';
import {areviewsReviewCsv} from '../lib/areviews-export.mjs';
import {reviewCountLimit,MAX_REVIEW_CHECKPOINTS} from '../lib/review-limits.mjs';

const source=readFileSync(new URL('../lib/review-run-engine.mjs',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
function uniqueText(id,suffix=''){
  return Array.from({length:24},(_,i)=>createHash('sha256').update(`${id}|${suffix}|${i}`).digest('hex').slice(0,9)).join(' ')+'.';
}
function harness({count=2000,alwaysFlag=false}={}){
  let row={id:'capacity-test',created_at:'2026-11-01T00:00:00Z',status:'queued',mode:'pdp_only',requested_count:count,completed_count:0,input_json:{productTitle:'Internal capacity test',productDescription:'Isolated synthetic QA capacity fixture.',reviewCount:count,targetAverage:4.7,externalReferencesEnabled:false},result_json:{reviews:[],steps:[]}};
  const calls=[],pending=new Set(Array.from({length:count},(_,i)=>i%3===0?'SYN-'+String(i+1).padStart(4,'0'):null).filter(Boolean));
  let failNextAssessment=false;
  const updateRun=async(id,patch)=>{if(row.status==='canceled')return row;row={...row,...patch};return row};
  const fetch=async(url,options)=>{
    const body=JSON.parse(options.body);calls.push({url,body});
    assert(Buffer.byteLength(options.body)<300000,'Each model API request stays bounded');
    if(url.endsWith('/generation-plan')){
      const start=body.previousThemes.length;
      return{ok:true,json:async()=>({plannerModel:'test-model',plannerProvider:'mock',themes:Array.from({length:Math.max(12,Math.ceil(body.reviewCount/4))},(_,i)=>({focus:`Test focus ${start+i}`,scenarioVariants:[0,1,2,3].map(j=>`Scenario ${start+i} variant ${j}`),evidenceBoundary:'Internal test data.',allowedRatings:[1,2,3,4,5]}))})};
    }
    if(url.endsWith('/generate')){
      assert(body.planItems.length<=10);
      return{ok:true,json:async()=>({model:'mock',reviews:body.planItems.map(item=>({...item,title:'Title '+item.id,body:uniqueText(item.id)}))})};
    }
    assert(url.endsWith('/corpus-qa'));
    assert(body.reviews.length>=5&&body.reviews.length<=50,'QA payload contains 5–50 reviews');
    if(body.mode==='assess'){
      if(failNextAssessment){failNextAssessment=false;throw Error('Injected retryable QA failure')}
      const ids=body.reviews.filter(review=>pending.has(review.id)).map(review=>review.id).slice(0,20);
      assert(ids.length<=20,'Mock assessor respects its 20-ID limit');
      return{ok:true,json:async()=>({diagnostics:{count:body.reviews.length,recommendedRepairIds:ids,overallDiversityScore:ids.length?40:92}})};
    }
    assert(body.repairIds.length<=24);
    const wanted=new Set(body.repairIds);
    if(!alwaysFlag)for(const id of wanted)pending.delete(id);
    return{ok:true,json:async()=>({reviews:body.reviews.map(review=>wanted.has(review.id)?{...review,title:review.title+' updated',body:uniqueText(review.id,'repair '+calls.length)}:review)})};
  };
  const dependencies={getRun:async()=>row,updateRun,reviewRatingSummary,syntheticReviewCsv,areviewsReviewCsv,...repair,...large,fetch};
  const api=new Function(...Object.keys(dependencies),source+'\nreturn {advanceRun,csvForRun,areviewsCsvForRun};')(...Object.values(dependencies));
  return{step:()=>api.advanceRun(row.id,'https://capacity-test.invalid'),row:()=>row,calls,api,pending,failAssessment:()=>{failNextAssessment=true}};
}

assert.equal(reviewCountLimit(false),2000);assert.equal(reviewCountLimit(true),250);
assert.equal(new Set(createPersonaProfiles(2000,'capacity').map(profile=>profile.signature)).size,2000);
assert.throws(()=>solveNaturalRatingDistribution(2001,4.7));

// Compare the optimized exact solver to the previous exhaustive algorithm.
const oldSolve=(()=>{
const RATING_ANCHORS=[
  {mean:1,shares:[1,0,0,0,0]},
  {mean:1.3,shares:[.83,.1,.03,.02,.02]},
  {mean:2,shares:[.3,.5,.12,.06,.02]},
  {mean:3,shares:[.1,.2,.4,.2,.1]},
  {mean:4,shares:[.02,.06,.12,.5,.3]},
  {mean:4.7,shares:[.02,.02,.03,.1,.83]},
  {mean:5,shares:[0,0,0,0,1]},
];

function desiredRatingShares(target){
  const value=Math.max(1,Math.min(5,Number(target)||0));
  let left=RATING_ANCHORS[0],right=RATING_ANCHORS.at(-1);
  for(let i=0;i<RATING_ANCHORS.length-1;i++)if(value>=RATING_ANCHORS[i].mean&&value<=RATING_ANCHORS[i+1].mean){left=RATING_ANCHORS[i];right=RATING_ANCHORS[i+1];break}
  if(left.mean===right.mean)return[...left.shares];
  const mix=(value-left.mean)/(right.mean-left.mean);
  return left.shares.map((share,i)=>share+(right.shares[i]-share)*mix);
}

function solveNaturalRatingDistribution(reviewCount,targetAverage){
  const n=Number(reviewCount),requested=Number(targetAverage);
  if(!Number.isInteger(n)||n<1||n>250)throw Error('Review count must be an integer from 1 to 250.');
  if(!(requested>=1&&requested<=5))throw Error('Target average must be from 1 to 5.');
  const total=Math.round(n*requested),target=total/n,desired=desiredRatingShares(target).map(x=>x*n);
  let best=null;
  for(let five=0;five<=n;five++)for(let four=0;four<=n-five;four++){
    const remaining=n-five-four,left=total-five*5-four*4;
    if(left<remaining||left>remaining*3)continue;
    for(let three=0;three<=remaining;three++){
      const two=left-remaining-twoOrZero(three),one=remaining-three-two;
      if(two<0||one<0||!Number.isInteger(two)||!Number.isInteger(one))continue;
      const counts=[one,two,three,four,five];
      const score=counts.reduce((sum,count,i)=>sum+((count-desired[i])**2/Math.max(1,desired[i])),0);
      if(!best||score<best.score)best={score,counts};
    }
  }
  if(!best)throw Error('Could not solve the requested rating distribution.');
  const [one,two,three,four,five]=best.counts,by={5:five,4:four,3:three,2:two,1:one};
  return{by,avg:Object.entries(by).reduce((sum,[rating,count])=>sum+Number(rating)*count,0)/n,requestedAverage:requested};
}

function twoOrZero(three){return three*2}


return solveNaturalRatingDistribution;})();
for(const n of [5,17,51,100,250])for(const avg of [1,1.3,2,2.64,3,3.5,4.1,4.7,4.93,5])assert.deepEqual(solveNaturalRatingDistribution(n,avg),oldSolve(n,avg));
for(const avg of [1,2,3,4.7,5]){
  const solved=solveNaturalRatingDistribution(2000,avg);
  assert.equal(Object.values(solved.by).reduce((a,b)=>a+b,0),2000);
  assert.equal(solved.avg,avg);
}

const h=harness();let steps=0,retried=false;
while(h.row().status!=='completed'&&steps<MAX_REVIEW_CHECKPOINTS){
  if(!retried&&h.row().result_json.pdpQuality?.assessmentOffset===3){
    h.failAssessment();await assert.rejects(h.step,/Injected retryable/);
    assert.equal(h.row().result_json.pdpQuality.assessmentOffset,3,'Failed QA cannot advance its checkpoint');retried=true;
  }
  await h.step();steps++;
}
assert.equal(h.row().status,'completed');assert(retried);
assert.equal(h.row().completed_count,2000);assert.equal(h.row().result_json.reviews.length,2000);
assert.equal(h.pending.size,0);assert.equal(h.row().result_json.corpusRepairCount,667);
assert.equal(h.row().result_json.pdpQuality.repairRounds,1,'One repair round covers all 667 flagged IDs');
assert.equal(h.calls.filter(call=>call.url.endsWith('/generate')).length,200);
assert.equal(h.calls.filter(call=>call.url.endsWith('/generation-plan')).length,25);
assert.equal(h.calls.filter(call=>call.body.mode==='repair').length,28);
assert.equal(h.row().result_json.corpusDiagnostics.count,2000);
assert.equal(h.row().result_json.corpusDiagnostics.chunkedAssessment.chunks,80);
assert.equal(h.row().result_json.plan.items.length,0,'Completed generation sheds redundant assignments');
assert.equal(h.row().result_json.finalResult.reviews,undefined,'Stored final result does not duplicate 2,000 reviews');
assert.equal(h.row().result_json.finalResult.actualAverage,4.7);
for(const review of h.row().result_json.reviews){assert(review.blueprint&&review.personaProfile);assert.equal(review.publicationAllowed,false)}

const product=buildCatalogResult({id:'test-catalog',input_json:{}},[h.row()]).products[0],loaded=[];
let offset=0,pages=0;
do{const page=resultPage(product,offset);assert(Buffer.byteLength(JSON.stringify(page))<4500000);loaded.push(...page.reviews);offset=page.pagination.nextOffset;pages++}while(offset!==null);
assert.equal(pages,20);assert.deepEqual(loaded,product.reviews);assert.equal(loaded.at(-1).id,'SYN-2000');
assert(Buffer.byteLength(JSON.stringify(publicReviewRun(h.row())))<4500000);
assert.equal(h.api.csvForRun(h.row()).trim().split('\n').length,2001);
assert.equal(h.api.areviewsCsvForRun(h.row()).trim().split('\n').length,2001);
const unicode='x'.repeat(32767)+'🌎'+'y'.repeat(32767);assert.equal(await new Response(streamText(unicode)).text(),unicode);

// Whole-corpus checks catch duplicates across distant QA/generation batches.
const distant=structuredClone(product.reviews);distant[1999].body=distant[0].body;distant[1998].title=distant[1].title;
const signals=corpusQualitySignals(distant);assert(signals.repairIds.includes('SYN-2000'));assert(signals.repairIds.includes('SYN-1999'));
for(const count of [251,499,1999,2000]){
  const reviews=Array.from({length:count},(_,i)=>({id:String(i),blueprint:{themeId:String(i%60)}})),chunks=large.largeAssessmentChunks(reviews,2);
  assert(chunks.every(chunk=>chunk.length>=5&&chunk.length<=50));
  for(const review of reviews)assert(chunks.flat().filter(item=>item.id===review.id).length>=2);
}
const blocked=harness({count:251,alwaysFlag:true});let blockedSteps=0;
while(blocked.row().result_json.pdpQuality?.phase!=='blocked'&&blockedSteps++<MAX_REVIEW_CHECKPOINTS)await blocked.step();
assert.equal(blocked.row().result_json.pdpQuality.repairRounds,3);
assert.equal(blocked.row().result_json.corpusDiagnostics.qaStatus,'needs_review');
await assert.rejects(blocked.step,/quality review is required/);
assert(!blocked.row().result_json.finalResult);
assert(26+200+4*80+3*Math.ceil(2000/24)+10<MAX_REVIEW_CHECKPOINTS,'Worst-case full repair coverage fits durable checkpoint budget');
console.log(JSON.stringify({ok:true,count:2000,steps,planningCalls:25,generationCalls:200,qaChunksPerPass:80,repaired:667,repairBatches:28,resultPages:20,retryResume:true,blockedAfterThreeRounds:true}));

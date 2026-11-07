import {readFileSync} from 'node:fs';
import * as helper from '../lib/pdp-corpus-repair.mjs';
import * as policy from '../lib/pdp-quality-policy.mjs';
import * as large from '../lib/pdp-large-run.mjs';
import {createHash} from 'node:crypto';

const engineSource=readFileSync(new URL('../lib/review-run-engine.mjs',import.meta.url),'utf8');
const qaSource=readFileSync(new URL('../app/api/corpus-qa/route.js',import.meta.url),'utf8');

function assert(condition,message){if(!condition)throw Error(message)}
function equal(actual,expected,message){assert(JSON.stringify(actual)===JSON.stringify(expected),message+': '+JSON.stringify(actual))}
async function rejects(work,pattern){let error;try{await work()}catch(caught){error=caught}assert(error&&pattern.test(error.message),'Expected rejection '+pattern)}
function executable(source){return source.replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'')}
function fixtures(count=40){return Array.from({length:count},(_,i)=>({id:'SYN-'+String(i+1).padStart(4,'0'),rating:i%5+1,title:'Fixture '+i,body:Array.from({length:16},(_,j)=>createHash('sha256').update(i+':'+j).digest('hex').slice(0,10)).join(' '),personaId:'PERSONA-'+i,personaProfile:{signature:'profile-'+i},blueprint:{themeId:'THEME-'+i},date:'2026-01-01',syntheticFixture:true,publicationAllowed:false}))}
function harness({flagged=38,alwaysFlag=false,failAssessment=false,canceled=false,legacy=false}={}){
  let row={id:'test-run',status:canceled?'canceled':'running',mode:'pdp_only',requested_count:40,completed_count:40,input_json:{productTitle:'Internal QA fixture',productDescription:'Synthetic test data only.',targetAverage:3},result_json:{plan:{items:[]},reviews:fixtures(),steps:[]}};
  if(legacy){row.result_json.pdpQuality={phase:'blocked',repairRounds:3,remainingRepairIds:['SYN-0001']};row.result_json.corpusRepairCount=300;}
  const pending=new Set(row.result_json.reviews.slice(0,flagged).map(review=>review.id)),calls=[];
  const getRun=async()=>structuredClone(row),updateRun=async(id,patch)=>{row={...row,...structuredClone(patch)};return structuredClone(row)};
  const fetch=async(url,options)=>{
    const payload=JSON.parse(options.body);calls.push(payload);
    if(payload.mode==='assess'){
      if(failAssessment)throw Error('Assessment provider unavailable');
      const ids=(alwaysFlag?['SYN-0001']:[...pending]).filter(id=>(payload.assessmentIds||payload.reviews.map(r=>r.id)).includes(id));
      return{ok:true,json:async()=>({model:'test-model',diagnostics:{count:payload.reviews.length,policyVersion:policy.PDP_QUALITY_POLICY,materialIssues:ids.map(id=>({id,kind:'off_product',relatedIds:[]})),recommendedRepairIds:ids,exactDuplicateGroups:[],duplicateTitleGroups:[],overallDiversityScore:ids.length?42:90}})};
    }
    assert(payload.mode==='repair','Only assessment and repair endpoints are expected');
    assert(payload.repairIds.length<=24,'Repair batch exceeded 24');
    const requested=new Set(payload.repairIds);
    const reviews=payload.reviews.map(review=>{
      if(!requested.has(review.id))return review;
      pending.delete(review.id);
      return{...review,title:review.title+' repaired',body:review.body+' Replacement '+calls.length+'.',diversityRepaired:true,diversityRepairReasons:['semantic_near_duplicate']};
    });
    return{ok:true,json:async()=>({reviews,repairCount:requested.size})};
  };
  const dependencies={getRun,updateRun,reviewRatingSummary:()=>({distribution:{},actualAverage:3}),syntheticReviewCsv:()=>'',areviewsReviewCsv:()=>'',...helper,...policy,...large,fetch};
  const api=new Function(...Object.keys(dependencies),executable(engineSource)+'\nreturn {advanceRun};')(...Object.values(dependencies));
  return{step:()=>api.advanceRun(row.id,'https://internal-test.invalid'),row:()=>row,calls};
}
const tests=[];
async function check(name,work){await work();tests.push(name)}

await check('38 flagged reviews are repaired in bounded batches, reassessed, and exported with metadata',async()=>{
  const h=harness(),before=fixtures();
  for(let i=0;i<10&&h.row().status!=='completed';i++)await h.step();
  equal(h.calls.map(call=>call.mode),['assess','repair','repair','assess','assess'],'Repair/recheck sequence');
  equal(h.calls.filter(call=>call.mode==='repair').map(call=>call.repairIds.length),[24,14],'Repair batches');
  equal(h.row().status,'completed','Completion status');
  equal(h.row().result_json.finalResult.corpusRepairCount,38,'Exported repair count');
  equal(h.row().result_json.reviews.length,40,'Review count');
  h.row().result_json.reviews.forEach((review,i)=>{
    equal(review.rating,before[i].rating,'Rating preserved');
    equal(review.blueprint,before[i].blueprint,'Blueprint preserved');
    equal(review.personaProfile,before[i].personaProfile,'Persona preserved');
    equal(review.publicationAllowed,false,'Synthetic label preserved');
  });
  equal(h.row().result_json.reviews.slice(38),before.slice(38),'Unflagged reviews untouched');
  const calls=h.calls.length;await h.step();equal(h.calls.length,calls,'Completed runs do not run repair again');
});
await check('old blocked checkpoints are reassessed before any repair and retain saved work',async()=>{
  const h=harness({flagged:0,legacy:true}),before=structuredClone(h.row().result_json.reviews);
  await h.step();equal(h.calls.length,0,'Policy migration does not spend');equal(h.row().result_json.pdpQuality.phase,'assess','Fresh assessment required');
  equal(h.row().result_json.corpusRepairCount,300,'Historical cost count retained');equal(h.row().result_json.reviews,before,'Saved bodies retained');
  await h.step();equal(h.calls.map(call=>call.mode),['assess'],'No old repair IDs replayed');
  await h.step();equal(h.row().status,'completed','Only fresh assessment can finalize');
});
await check('clean assessment skips repair',async()=>{
  const h=harness({flagged:0});await h.step();await h.step();
  equal(h.row().status,'completed','Clean corpus completes');
  equal(h.calls.map(call=>call.mode),['assess'],'No unnecessary repair');
});
await check('QA failure cannot finalize a job',async()=>{
  const h=harness({failAssessment:true});await rejects(h.step,/Assessment provider unavailable/);
  equal(h.row().status,'running','Failure remains retryable');
  assert(!h.row().result_json.finalResult,'QA failure must not create a final result');
});
await check('unresolved quality is persisted and blocked after three repair rounds',async()=>{
  const h=harness({alwaysFlag:true});
  for(let i=0;i<20&&h.row().result_json.pdpQuality?.phase!=='blocked';i++)await h.step();
  equal(h.row().result_json.pdpQuality.phase,'blocked','Bounded repair limit');
  equal(h.row().result_json.corpusDiagnostics.qaStatus,'needs_review','Needs review recorded');
  await rejects(h.step,/quality review is required/);
  assert(!h.row().result_json.finalResult,'Unresolved reviews must not finalize');
  equal(h.calls.filter(call=>call.mode==='repair').length,3,'No unbounded repair loop');
});
await check('canceled runs do not call the model',async()=>{
  const h=harness({canceled:true});await h.step();equal(h.calls.length,0,'Canceled run');
});
await check('repair merge rejects lost rows, changed ratings, and unrelated edits',async()=>{
  const original=fixtures(5),copy=()=>structuredClone(original);
  await rejects(()=>helper.mergePdpRepairs(original,{reviews:copy().slice(1)},[original[0].id]),/incomplete/);
  let changed=copy();changed[0].rating=99;
  await rejects(()=>helper.mergePdpRepairs(original,{reviews:changed},[original[0].id]),/assigned rating/);
  changed=copy();changed[1].body+=' Unrequested change.';
  await rejects(()=>helper.mergePdpRepairs(original,{reviews:changed},[original[0].id]),/unrequested/);
});
const fakeResponse={json:(body,options={})=>({status:options.status||200,body})};
function qaHarness(modelOutput){
  let calls=0,prompt='';
  const gateway=async(req,input)=>{calls++;prompt=input;return{text:JSON.stringify(modelOutput)}};
  const dependencies={gateway,MODEL:'test-model',Response:fakeResponse,...policy};
  const api=new Function(...Object.keys(dependencies),executable(qaSource)+'\nreturn {POST};')(...Object.values(dependencies));
  return{post:input=>api.POST({json:async()=>input}),calls:()=>calls,prompt:()=>prompt};
}
const qaInput={mode:'repair',productTitle:'Internal fixture',productDescription:'Synthetic test context.',reviews:fixtures(5),repairIds:['SYN-0001'],repairDiagnostics:{recommendedRepairIds:['SYN-0001']}};
await check('repair API enforces requested IDs and preserves ratings',async()=>{
  const h=qaHarness({repairs:[{id:'SYN-0001',rating:99,title:'Repaired fixture',body:'A distinct replacement body for internal QA testing.',reasons:['semantic_near_duplicate']}]});
  const response=await h.post(qaInput);
  equal(response.status,200,'Repair API response');
  equal(response.body.repairCount,1,'Actual replacements counted');
  equal(response.body.reviews[0].rating,qaInput.reviews[0].rating,'Model cannot change rating');
  equal(response.body.reviews[1].body,qaInput.reviews[1].body,'Unrequested body preserved');
  assert(h.prompt().includes('REQUESTED REPAIR IDS'),'Requested IDs must reach editor prompt');
});
await check('repair API rejects unknown, duplicate, and excessive requested IDs before AI calls',async()=>{
  for(const ids of [['missing'],['SYN-0001','SYN-0001'],Array(25).fill('SYN-0001')]){
    const h=qaHarness({});const response=await h.post({...qaInput,repairIds:ids});
    equal(response.status,500,'Invalid IDs rejected');equal(h.calls(),0,'No paid AI call for invalid input');
  }
});
await check('repair API rejects changes outside the requested set and missing repairs',async()=>{
  for(const repairs of [[],[{id:'SYN-0002',title:'Changed',body:'This unrequested replacement must be rejected.'}]]){
    const h=qaHarness({repairs}),response=await h.post(qaInput);
    equal(response.status,500,'Invalid model repair rejected');
  }
});
console.log(JSON.stringify({ok:true,tests:tests.length,checks:tests}));

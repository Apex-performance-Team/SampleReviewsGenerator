import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {advanceLargePdpPlan} from '../lib/pdp-large-run.mjs';
import {sanitizeThemes} from '../lib/review-blueprint.mjs';
import * as policy from '../lib/pdp-planning-policy.mjs';
import {PDP_REVIEW_LIMIT} from '../lib/review-limits.mjs';

const theme=i=>({focus:`Focus ${i}`,scenarioVariants:[0,1,2,3].map(j=>`Scenario ${i} ${j}`),evidenceBoundary:'Only documented facts.',allowedRatings:[1,2,3,4,5]});
const saved=sanitizeThemes(Array.from({length:40},(_,i)=>theme(i)),{minimum:40,maximum:40});
function harness(handler){
  let run={id:'saved-failed-run',status:'failed',requested_count:278,created_at:'2026-11-07T06:01:13Z',input_json:{productTitle:'Internal test frame',productDescription:'Internal QA context.',targetAverage:4.7},result_json:{reviews:[],pdpPlanning:{themes:structuredClone(saved),batches:[{count:20},{count:20}]}}};
  const calls=[];
  const postJson=async(origin,path,body)=>{calls.push(body);return handler(body,calls.length)};
  const updateRun=async(id,patch)=>{run={...run,...structuredClone(patch)};return run};
  return{step:()=>advanceLargePdpPlan({run,origin:'https://test.invalid',input:run.input_json,result:run.result_json,postJson,updateRun}),row:()=>run,calls};
}
function success(body){return{themes:Array.from({length:body.themeCount},(_,i)=>theme(body.previousThemes.length+i)),plannerModel:'test',plannerProvider:'test'}}
const checks=[];
const recovering=harness((body,n)=>{if(n<=3)throw Error('AI Gateway request was aborted due to timeout');return success(body)});
for(let i=0;i<4;i++){
  await recovering.step();
  assert.deepEqual(recovering.row().result_json.pdpPlanning.themes.slice(0,40),saved,'Saved themes must survive every retry');
}
assert.deepEqual(recovering.calls.map(call=>call.themeCount),[8,4,2,1]);
assert.equal(recovering.row().result_json.pdpPlanning.themes.length,41);
assert.equal(recovering.row().result_json.pdpPlanning.stalledAttempts,0);
while(!recovering.row().result_json.plan)await recovering.step();
assert.equal(recovering.row().result_json.plan.items.length,278);
assert.equal(recovering.row().result_json.plan.themes.length,70);
checks.push('Saved 40-theme failure resumes through 8/4/2/1 retries and completes all 278 assignments');

const partial=harness(body=>({themes:[theme(0),theme(40),{focus:'broken'}],plannerModel:'test'}));
await partial.step();assert.equal(partial.row().result_json.pdpPlanning.themes.length,41);assert.equal(partial.row().result_json.pdpPlanning.batchSize,1);
checks.push('Valid partial output is retained while duplicate and invalid themes are excluded');

for(const [message,code] of [['AI Gateway 402: positive credit balance required','PLANNER_BILLING'],['AI Gateway 401: invalid authentication','PLANNER_AUTH'],['AI Gateway 429: rate limit','PLANNER_RATE_LIMIT']]){
  const h=harness(()=>{throw Error(message)});await assert.rejects(h.step,error=>error.code===code);assert.equal(h.calls.length,1);assert.deepEqual(h.row().result_json.pdpPlanning.themes,saved);
}
checks.push('Billing/auth errors stop and rate limits propagate for delayed workflow retries');

const unavailable=harness(()=>{throw Error('AI Gateway timeout')});
for(let i=0;i<policy.PDP_PLANNING_STALL_LIMIT;i++)await unavailable.step();
assert.equal(unavailable.row().result_json.pdpPlanning.blocked,true);
await assert.rejects(unavailable.step,error=>error.code==='PLANNER_BLOCKED');
assert.equal(unavailable.calls.length,policy.PDP_PLANNING_STALL_LIMIT);
assert.deepEqual(unavailable.row().result_json.pdpPlanning.themes,saved);
checks.push('A sustained outage stops after a bounded number of requests without losing progress');

// Exercise the actual route contract, including the one-theme case. The old
// endpoint derived a minimum of 12 themes from reviewCount and could not shrink.
const route=readFileSync(new URL('../app/api/generation-plan/route.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
function routeHarness(gateway){const dependencies={gateway,MODEL:'test',sanitizeThemes,PDP_REVIEW_LIMIT,...policy};return new Function(...Object.keys(dependencies),route+'\nreturn POST;')(...Object.values(dependencies))}
for(const count of [1,2,4,8]){
  let prompt;
  const post=routeHarness(async(req,text,timeout)=>{prompt=text;assert.equal(timeout,75000);return{text:JSON.stringify({themes:Array.from({length:count},(_,i)=>theme(i))}),provider:'test'}});
  const response=await post({json:async()=>({planningMode:'theme_batch',themeCount:count,reviewCount:2000,productTitle:'Test',productDescription:'Test context.'})});
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.themes.length,count);assert.equal(body.items,undefined);assert(prompt.includes(`Plan exactly ${count}`));
}
checks.push('Theme-only API requests exactly 1, 2, 4 or 8 themes, independently of job size');
for(const [message,status,code] of [['AI Gateway timeout',504,'PLANNER_TIMEOUT'],['AI Gateway 402: positive credit balance required',402,'PLANNER_BILLING']]){
  const post=routeHarness(async()=>{throw Error(message)}),response=await post({json:async()=>({planningMode:'theme_batch',themeCount:1,reviewCount:278,productTitle:'Test',productDescription:'Context'})});
  assert.equal(response.status,status);const body=await response.json();assert.equal(body.code,code);assert.equal(body.themes,undefined);
}
checks.push('The API returns typed failures rather than disguising them as successful fallback plans');
const invalid=routeHarness(async()=>{throw Error('Must not call model for invalid input')});
assert.equal((await invalid({json:async()=>({planningMode:'theme_batch',themeCount:20,reviewCount:2000,productTitle:'Test',productDescription:'Context'})})).status,400);
const workflowSource=readFileSync(new URL('../workflows/store-review-catalog.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
class FatalError extends Error{}
class RetryableError extends Error{constructor(message,options){super(message);this.options=options}}
for(const code of ['PLANNER_BLOCKED','PLANNER_BILLING','PLANNER_AUTH','PLANNER_INPUT','PLANNER_RATE_LIMIT']){
  const advanceRun=async()=>{const error=new Error('Model request stopped');error.code=code;throw error};
  const step=new Function('MAX_REVIEW_CHECKPOINTS','FatalError','RetryableError','advanceRun',workflowSource+'\nreturn advanceReviewRunStep;')(2000,FatalError,RetryableError,advanceRun);
  await assert.rejects(()=>step('run','origin'),error=>code==='PLANNER_RATE_LIMIT'?error instanceof RetryableError&&error.options.retryAfter==='30s':error instanceof FatalError);
}
checks.push('Durable workflow stops terminal planner errors immediately and backs off rate limits');
console.log(JSON.stringify({ok:true,checks}));

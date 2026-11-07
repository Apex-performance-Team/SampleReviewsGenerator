import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as policy from '../lib/pdp-quality-policy.mjs';
import {corpusQualitySignals} from '../lib/review-blueprint.mjs';
import {repairVerificationChunks,advanceLargePdpQuality} from '../lib/pdp-large-run.mjs';

const rows=[
  {id:'SYN-0001',rating:5,title:'Works great',body:'My grandmother has no interest in another phone app. Her children send the pictures and she watches them on the frame.',blueprint:{themeId:'A',focus:'Simple recipient experience'},personaProfile:{voice:'clipped',minWords:9,maxWords:32}},
  {id:'SYN-0002',rating:5,title:'Works great',body:'Grandma does not want a phone app to learn. Her children handle sending the pictures while she watches them on the frame.',blueprint:{themeId:'B',focus:'Remote family contributions'},personaProfile:{voice:'informal',minWords:9,maxWords:32}},
  {id:'SYN-0003',rating:4,title:'Works great',body:'The screen fits our kitchen counter, although I had to move the fruit bowl. The cord reaches the socket behind it.'},
  {id:'SYN-0004',rating:4,title:'Family updates',body:'New school photos arrive during the week. Sometimes the kids forget to send them, but the older pictures are still nice to see.'},
  {id:'SYN-0005',rating:5,title:'Fresh pictures',body:'My daughter sent campus photos throughout her first semester. I enjoy seeing her new surroundings between our weekend calls.'},
  {id:'SYN-0006',rating:5,title:'Little moments',body:'A school drawing appears beside a picture of our dog. The mixed collection is less polished than an album and that suits us.'},
];
const issue={id:'SYN-0002',kind:'repetitive',severity:'high',confidence:.98,reason:'The same grandmother refusing an app and children sending pictures is repeated.',relatedIds:['SYN-0001'],evidence:rows.slice(0,2).map(row=>({id:row.id,quote:row.body}))};
const structured=policy.materialIssues([issue],rows,'A Wi-Fi photo frame with a 15-second video limit.');
assert.equal(structured.length,1);
assert.deepEqual(policy.materialRepairIds({materialIssues:structured},rows),['SYN-0002']);
assert.deepEqual(policy.materialRepairIds({materialIssues:[...structured,{...structured[0],id:'SYN-0001',relatedIds:['SYN-0002']}]},rows),['SYN-0002'],'Opposite chunk order must not rewrite both copies');
assert.deepEqual(policy.materialRepairIds({materialIssues:structured},rows,{eligibleIds:['SYN-0001']}),['SYN-0001'],'Recheck fixes the changed copy and preserves untouched context');
assert.deepEqual(policy.materialIssues([{...issue,confidence:.7},{...issue,severity:'low'},{...issue,kind:'topic_saturation'},{...issue,evidence:[{id:'SYN-0002',quote:'Words not present in either review.'}]}],rows),[]);
assert.deepEqual(policy.materialIssues([{...issue,kind:'contradicted_fact',productEvidence:'Invented product facts not in PDP'}],rows,'Photos only'),[]);
const wrong={...issue,kind:'off_product',relatedIds:[],reason:'This fixture describes a different product category.'};
assert.deepEqual(policy.materialRepairIds({materialIssues:policy.materialIssues([wrong],rows)},rows),['SYN-0002']);
assert.deepEqual(policy.materialRepairIds({...corpusQualitySignals(rows),recommendedRepairIds:rows.map(row=>row.id),topics:[{share:.5,saturated:true,ids:['SYN-0004','SYN-0005','SYN-0006']}],overallDiversityScore:10},rows),[],'Topic proportions, titles, score and bare recommendations do not authorize repairs');
const duplicate=structuredClone(rows);duplicate[5].body=duplicate[2].body;
assert.deepEqual(policy.materialRepairIds(corpusQualitySignals(duplicate),duplicate),['SYN-0006'],'Exact copied bodies still require repair');
const many=Array.from({length:100},(_,i)=>({...rows[0],id:`SYN-${String(i).padStart(4,'0')}`,body:rows[0].body+' Unique suffix '+i}));
assert.equal(policy.materialRepairIds(corpusQualitySignals(many),many).length,99,'Global near-verbatim coverage is not truncated to the 40 displayed pairs');
assert.equal(policy.qualityState({phase:'blocked',repairRounds:3}).phase,'assess');
assert.equal(policy.qualityState({phase:'blocked',repairRounds:3}).previousPolicyRepairRounds,3);
const current={phase:'repair',repairRounds:1,policyVersion:policy.PDP_QUALITY_POLICY};assert.equal(policy.qualityState(current),current,'Resume preserves current-policy checkpoints');

const source=readFileSync(new URL('../app/api/corpus-qa/route.js',import.meta.url),'utf8').replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
let prompt='',calls=0,modelOutput;
const dependencies={...policy,MODEL:'mock',Response:{json:(body,options={})=>({body,status:options.status||200})},gateway:async(req,text)=>{prompt=text;calls++;return{text:JSON.stringify(modelOutput)}}};
const api=new Function(...Object.keys(dependencies),source+'\nreturn {POST};')(...Object.values(dependencies));
const input={productTitle:'Photo frame',productDescription:'A Wi-Fi photo frame with a 15-second video limit.',reviews:rows};
modelOutput={overallDiversityScore:12,materialIssues:[],recommendedRepairIds:rows.map(row=>row.id)};
let result=await api.POST({json:async()=>({...input,mode:'assess'})});
assert.equal(result.status,200);assert.deepEqual(result.body.diagnostics.recommendedRepairIds,[]);
modelOutput={overallDiversityScore:85,materialIssues:[issue]};
result=await api.POST({json:async()=>({...input,mode:'assess'})});assert.deepEqual(result.body.diagnostics.recommendedRepairIds,['SYN-0002']);
modelOutput={repairs:[{id:'SYN-0002',title:'An update after school',body:'I send one picture after school. My parents enjoy seeing what the children made that afternoon.',reasons:['repetitive']}]};
result=await api.POST({json:async()=>({...input,mode:'repair',repairIds:['SYN-0002'],repairDiagnostics:{materialIssues:structured}})});
assert.equal(result.status,200);assert(prompt.includes('Remote family contributions'));assert(prompt.includes('informal'));assert(prompt.includes('maxWords'));
assert.deepEqual(result.body.reviews[1].blueprint,rows[1].blueprint);assert.deepEqual(result.body.reviews[1].personaProfile,rows[1].personaProfile);
assert.deepEqual(result.body.reviews[0],{...result.body.reviews[0],title:rows[0].title,body:rows[0].body});
modelOutput={repairs:[{id:'SYN-0002',title:'Unwanted essay',body:'A very long invented story. '.repeat(50)}]};
result=await api.POST({json:async()=>({...input,mode:'repair',repairIds:['SYN-0002']})});assert.equal(result.status,500);assert.match(result.body.error,/assigned review length/);
modelOutput={repairs:[]};result=await api.POST({json:async()=>({...input,mode:'repair',repairIds:['SYN-0002']})});assert.equal(result.status,500);

const chunks=repairVerificationChunks(rows,['SYN-0002'],{materialIssues:structured});assert.equal(chunks.length,1);assert.deepEqual(chunks[0].assessmentIds,['SYN-0002']);assert(chunks[0].reviews.some(row=>row.id==='SYN-0001'));
let saved;
await advanceLargePdpQuality({run:{id:'test'},origin:'https://test.invalid',input,result:{reviews:rows,pdpQuality:{phase:'assess',repairRounds:1,policyVersion:policy.PDP_QUALITY_POLICY,verificationIds:['SYN-0002']}},postJson:async(origin,path,payload)=>{
  assert.deepEqual(payload.assessmentIds,['SYN-0002']);
  return{diagnostics:{count:payload.reviews.length,policyVersion:policy.PDP_QUALITY_POLICY,overallDiversityScore:5,materialIssues:[{id:'SYN-0003',kind:'off_product',relatedIds:[]}],recommendedRepairIds:['SYN-0003']}};
},updateRun:async(id,patch)=>{saved=patch}});
assert.equal(saved.result_json.pdpQuality.phase,'passed','Low scores and unrelated context flags cannot restart a repair loop');
console.log(JSON.stringify({ok:true,checks:'material evidence, ordinary overlap, exact/semantic copies, stable keeper, policy migration, metadata, length, targeted recheck',modelCalls:'mock only',apiCases:calls}));

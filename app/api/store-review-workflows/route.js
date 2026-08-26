export const runtime='nodejs';
export const maxDuration=180;

import { createHash } from 'node:crypto';
import { start } from 'workflow/api';
import { claimQueuedRun,createRun,getRun,getRuns,listCatalogRuns,runStoreMode,updateRun } from '../../../lib/review-run-store.mjs';
import { catalogStatus } from '../../../lib/store-review-catalog.mjs';
import { publicRunRateLimit } from '../../../lib/public-run-rate-limit.mjs';
import { storeReviewCatalogWorkflow } from '../../../workflows/store-review-catalog.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function clean(value,max=1000){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function requestedCount(value){const n=Number(value);if(!Number.isInteger(n)||n<5||n>250)throw Error('Every review count must be 5–250.');return n}
function targetAverage(value){const n=Number(value??4.7);if(!(n>=1&&n<=5))throw Error('Target average must be 1–5.');return n}
function catalogId(value){const id=clean(value,80);if(!UUID.test(id))throw Error('A valid catalogId UUID is required.');return id}
function childId(parentId,index){const bytes=createHash('sha256').update(`${parentId}:${index}`).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=bytes.toString('hex');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`}
function deploymentOrigin(req){const host=clean(process.env.VERCEL_URL,500);return host?`https://${host}`:new URL(req.url).origin}
function modeFromReferences(enabled){return enabled?'source_rewrite':'pdp_only'}
function referenceBudget(value){return['test','balanced','thorough'].includes(value)?value:'balanced'}
async function findRun(id){try{return await getRun(id)}catch(error){if(error.message==='Run not found.')return null;throw error}}
async function getOrCreateRun(input,id){
  const existing=await findRun(id);if(existing)return existing;
  try{return await createRun(input,{id})}catch(error){if(/\b409\b|duplicate|unique/i.test(error.message))return getRun(id);throw error}
}
function productInput(product,body){
  const productUrl=clean(product.productUrl||product.url,1000),productTitle=clean(product.productTitle||product.title,240),productDescription=clean(product.productDescription,9000),reviewCount=requestedCount(product.reviewCount??product.requestedReviewCount),externalReferencesEnabled=Boolean(body.externalReferencesEnabled);
  if(!productUrl&&(!productTitle||!productDescription))throw Error('Every product needs a URL or product title/context.');
  return{productUrl,amazonListingUrl:clean(product.amazonListingUrl,1000),productTitle,productDescription,reviewCount,targetAverage:targetAverage(product.targetAverage??body.targetAverage),mode:modeFromReferences(externalReferencesEnabled),externalReferencesEnabled,referenceBudget:referenceBudget(product.referenceBudget||body.referenceBudget),existingReviewCount:product.existingReviewCount??product.extracted?.existingReviewCount??null};
}

export async function GET(req){
  try{
    const limit=Math.max(1,Math.min(30,Number(new URL(req.url).searchParams.get('limit'))||20)),[active,recent]=await Promise.all([listCatalogRuns(50,{statuses:['queued','running']}),listCatalogRuns(limit)]),catalogs=[...active,...recent.filter(catalog=>!active.some(item=>item.id===catalog.id))],childIds=[...new Set(catalogs.flatMap(catalog=>catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||[]))],childBatches=[];
    for(let offset=0;offset<childIds.length;offset+=100)childBatches.push(childIds.slice(offset,offset+100));
    const children=(await Promise.all(childBatches.map(ids=>getRuns(ids)))).flat(),byId=new Map(children.map(run=>[run.id,run]));
    const runs=catalogs.map(catalog=>catalogStatus(catalog,(catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||[]).map(id=>byId.get(id)).filter(Boolean)));
    return Response.json({runs,store:runStoreMode()},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error.message||'Could not list catalog workflows.'},{status:500,headers:{'cache-control':'no-store'}})}
}

export async function POST(req){
  const limited=publicRunRateLimit(req,{label:'store-review-workflow-start',limit:20,windowMs:15*60*1000});if(limited)return limited;
  try{
    if(runStoreMode()!=='supabase')throw Error('Supabase durable storage is required before a server workflow can start.');
    const body=await req.json(),id=catalogId(body.catalogId),resumeIds=Array.isArray(body.resumeRunIds)?[...new Set(body.resumeRunIds.map(value=>clean(value,80)))]:[];
    if(resumeIds.some(value=>!UUID.test(value)))throw Error('Every resumeRunId must be a valid UUID.');
    let children,inputs;
    if(resumeIds.length){
      if(resumeIds.length>100)throw Error('A catalog workflow supports at most 100 SKUs.');
      children=await getRuns(resumeIds);if(children.length!==resumeIds.length)throw Error('One or more runs selected for recovery no longer exist.');
      inputs=children.map(run=>run.input_json||{});
    }else{
      if(!Array.isArray(body.products)||!body.products.length)throw Error('At least one product is required.');
      if(body.products.length>100)throw Error('A catalog workflow supports at most 100 SKUs.');
      inputs=body.products.map(product=>productInput(product,body));
      children=await Promise.all(inputs.map((input,index)=>getOrCreateRun(input,childId(id,index))));
    }
    const childRunIds=children.map(run=>run.id),total=children.reduce((n,run)=>n+(Number(run.requested_count)||0),0),sourceMode=children.some(run=>run.mode==='source_rewrite'),maxConcurrency=12,concurrency=Math.max(1,Math.min(maxConcurrency,Number(body.concurrency)||1,children.length)),bulk=body.bulk!==false&&children.length>1;
    const catalogInput={catalogRun:true,durable:true,bulk,childRunIds,reviewCount:total,targetAverage:targetAverage(body.targetAverage??inputs[0]?.targetAverage),mode:'pdp_only',productTitle:bulk?`${children.length} SKU durable catalog`:clean(inputs[0]?.productTitle,240),productDescription:'Durable server-side review generation controller.',externalReferencesEnabled:sourceMode,concurrency,referenceBudget:referenceBudget(body.referenceBudget),resumedFromExistingRuns:Boolean(resumeIds.length)};
    let catalog=await getOrCreateRun(catalogInput,id);
    if(!catalog.input_json?.catalogRun)throw Error('catalogId is already assigned to a non-catalog run.');
    if(catalog.status==='queued')catalog=await updateRun(id,{input_json:{...(catalog.input_json||{}),...catalogInput},result_json:{...(catalog.result_json||{}),childRunIds,durable:true}});
    const claimed=await claimQueuedRun(id,{current_step:'starting_workflow',progress_message:'Handing generation to the durable server workflow.'});
    if(!claimed){
      catalog=await getRun(id);children=await getRuns(catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||childRunIds);
      return Response.json({started:false,resumed:true,catalogId:id,workflowRunId:catalog.result_json?.workflowRunId||null,status:catalogStatus(catalog,children)},{status:202,headers:{'cache-control':'no-store'}});
    }
    let workflowRun;
    try{workflowRun=await start(storeReviewCatalogWorkflow,[id,childRunIds,deploymentOrigin(req),concurrency])}
    catch(error){await updateRun(id,{status:'failed',current_step:'failed',progress_message:'Could not start durable workflow.',error:clean(error.message,1000)});throw error}
    catalog=await getRun(id);
    catalog=await updateRun(id,{result_json:{...(catalog.result_json||{}),childRunIds,durable:true,workflowRunId:workflowRun.runId}});
    return Response.json({started:true,catalogId:id,workflowRunId:workflowRun.runId,status:catalogStatus(catalog,children,'pending')},{status:202,headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error.message||'Could not start durable review workflow.'},{status:/required|must be|valid|at least|supports at most|already assigned|no longer exist/i.test(error.message)?400:500,headers:{'cache-control':'no-store'}})}
}

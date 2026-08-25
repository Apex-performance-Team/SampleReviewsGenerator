import{FatalError,RetryableError}from'workflow';
import{advanceRun}from'../lib/review-run-engine.mjs';
import{compactReviewRun}from'../lib/store-review-catalog.mjs';
import{getRun,getRuns,updateRun}from'../lib/review-run-store.mjs';

const MAX_CHECKPOINTS=140;

function messageFrom(error){return String(error?.message||error||'Unknown workflow error').slice(0,1000)}
function permanentFailure(message){return /must be|is required|not found|not configured|invalid run|zero final reviews|no source review bodies|product url or product title/i.test(message)}

async function advanceReviewRunStep(runId,origin){
  'use step';
  try{return compactReviewRun(await advanceRun(runId,origin))}
  catch(error){
    const message=messageFrom(error);
    if(permanentFailure(message))throw new FatalError(message);
    if(/\b429\b|rate.?limit|too many requests/i.test(message))throw new RetryableError(message,{retryAfter:'30s'});
    throw error;
  }
}
advanceReviewRunStep.maxRetries=5;

async function failReviewRunStep(runId,error){
  'use step';
  const message=messageFrom(error);
  return compactReviewRun(await updateRun(runId,{status:'failed',current_step:'failed',progress_message:'Run failed after durable retries.',error:message}));
}
failReviewRunStep.maxRetries=5;

async function startCatalogStep(catalogRunId,childCount){
  'use step';
  const run=await getRun(catalogRunId);
  return compactReviewRun(await updateRun(catalogRunId,{status:'running',current_step:'durable_generation',progress_message:`Durable server workflow is processing ${childCount} SKU${childCount===1?'':'s'}.`,result_json:{...(run.result_json||{}),durable:true}}));
}
startCatalogStep.maxRetries=5;

async function finishCatalogStep(catalogRunId,childRunIds){
  'use step';
  const [catalog,children]=await Promise.all([getRun(catalogRunId),getRuns(childRunIds)]),completed=children.reduce((n,run)=>n+(Number(run.completed_count)||0),0),purged=children.reduce((n,run)=>n+(Number(run.purged_count)||0),0),failed=children.filter(run=>run.status==='failed');
  const progressMessage=failed.length?`Finished with ${failed.length} failed SKU${failed.length===1?'':'s'}; completed results remain exportable.`:`Completed ${children.length} SKU${children.length===1?'':'s'} on the server.`;
  await updateRun(catalogRunId,{status:'completed',completed_count:completed,purged_count:purged,current_step:failed.length?'completed_with_errors':'completed',progress_message:progressMessage,error:failed.length?failed.map(run=>`${run.product_title||run.id}: ${run.error||'failed'}`).join('\n').slice(0,1000):null,result_json:{...(catalog.result_json||{}),durable:true,failedRunIds:failed.map(run=>run.id)},completed_at:new Date().toISOString()});
  return{completed,failed:failed.length,total:children.length};
}
finishCatalogStep.maxRetries=5;

async function failCatalogStep(catalogRunId,error){
  'use step';
  const message=messageFrom(error),catalog=await getRun(catalogRunId);
  await updateRun(catalogRunId,{status:'failed',current_step:'failed',progress_message:'Durable catalog workflow failed.',error:message,result_json:{...(catalog.result_json||{}),durable:true}});
  return{failed:true,error:message};
}
failCatalogStep.maxRetries=5;

export async function reviewRunWorkflow(runId,origin){
  'use workflow';
  try{
    for(let checkpoint=0;checkpoint<MAX_CHECKPOINTS;checkpoint++){
      const run=await advanceReviewRunStep(runId,origin);
      if(run.status==='completed'||run.status==='canceled')return{ok:run.status==='completed',run};
    }
    throw new Error(`Review run exceeded ${MAX_CHECKPOINTS} durable checkpoints.`);
  }catch(error){
    const run=await failReviewRunStep(runId,messageFrom(error));
    return{ok:false,run,error:messageFrom(error)};
  }
}

export async function storeReviewCatalogWorkflow(catalogRunId,childRunIds,origin,concurrency){
  'use workflow';
  try{
    await startCatalogStep(catalogRunId,childRunIds.length);
    const width=Math.max(1,Math.min(12,Number(concurrency)||1));
    for(let offset=0;offset<childRunIds.length;offset+=width){
      const group=childRunIds.slice(offset,offset+width);
      await Promise.all(group.map(runId=>reviewRunWorkflow(runId,origin)));
    }
    return await finishCatalogStep(catalogRunId,childRunIds);
  }catch(error){
    await failCatalogStep(catalogRunId,messageFrom(error));
    throw error;
  }
}

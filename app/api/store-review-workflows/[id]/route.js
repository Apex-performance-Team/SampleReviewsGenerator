export const runtime='nodejs';

import{getRun as getWorkflowRun}from'workflow/api';
import{cancelRuns,getRun,getRuns,runStoreMode}from'../../../../lib/review-run-store.mjs';
import{catalogStatus}from'../../../../lib/store-review-catalog.mjs';
import{publicRunRateLimit}from'../../../../lib/public-run-rate-limit.mjs';

export async function GET(req,{params}){
  try{
    const{id}=await params,catalog=await getRun(id);if(!catalog.input_json?.catalogRun)throw Error('Catalog workflow not found.');
    const childRunIds=catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||[],children=await getRuns(childRunIds),workflowRunId=catalog.result_json?.workflowRunId;
    let workflowStatus=null;
    if(workflowRunId)try{workflowStatus=await getWorkflowRun(workflowRunId).status}catch{}
    return Response.json({...catalogStatus(catalog,children,workflowStatus),store:runStoreMode()},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error.message||'Could not read catalog workflow.'},{status:/not found/i.test(error.message)?404:500,headers:{'cache-control':'no-store'}})}
}
export async function DELETE(req,{params}){
  const limited=publicRunRateLimit(req,{label:'store-review-workflow-cancel',limit:60,windowMs:15*60*1000});if(limited)return limited;
  try{
    const{id}=await params,catalog=await getRun(id);if(!catalog.input_json?.catalogRun)throw Error('Catalog workflow not found.');
    if(['completed','failed'].includes(catalog.status))return Response.json({error:`A ${catalog.status} generation cannot be canceled.`},{status:409,headers:{'cache-control':'no-store'}});
    const childRunIds=catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||[],workflowRunId=catalog.result_json?.workflowRunId;
    await cancelRuns([id],'Canceled by user. No additional SKUs will be started.');
    await cancelRuns(childRunIds,'Canceled with the whole catalog generation.');
    let workflowCanceled=!workflowRunId,warning=null;
    if(workflowRunId)try{
      const workflowRun=getWorkflowRun(workflowRunId),exists=await workflowRun.exists;
      if(exists){
        const status=await workflowRun.status;
        if(['pending','running'].includes(status)){await workflowRun.cancel();workflowCanceled=true}
        else workflowCanceled=status==='cancelled';
      }else warning='The Workflow run was not found, but persisted generation work was canceled.';
    }catch(error){warning=`Persisted generation work was canceled; Workflow cancellation could not be confirmed: ${String(error?.message||error).slice(0,300)}`}
    const [updatedCatalog,children]=await Promise.all([getRun(id),getRuns(childRunIds)]);
    return Response.json({...catalogStatus(updatedCatalog,children,workflowCanceled?'cancelled':null),canceled:true,workflowCanceled,warning,store:runStoreMode()},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error.message||'Could not cancel catalog workflow.'},{status:/not found/i.test(error.message)?404:500,headers:{'cache-control':'no-store'}})}
}

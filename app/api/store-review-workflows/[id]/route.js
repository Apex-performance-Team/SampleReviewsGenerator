export const runtime='nodejs';

import{getRun as getWorkflowRun}from'workflow/api';
import{getRun,getRuns,runStoreMode}from'../../../../lib/review-run-store.mjs';
import{catalogStatus}from'../../../../lib/store-review-catalog.mjs';

export async function GET(req,{params}){
  try{
    const{id}=await params,catalog=await getRun(id);if(!catalog.input_json?.catalogRun)throw Error('Catalog workflow not found.');
    const childRunIds=catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||[],children=await getRuns(childRunIds),workflowRunId=catalog.result_json?.workflowRunId;
    let workflowStatus=null;
    if(workflowRunId)try{workflowStatus=await getWorkflowRun(workflowRunId).status}catch{}
    return Response.json({...catalogStatus(catalog,children,workflowStatus),store:runStoreMode()},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error.message||'Could not read catalog workflow.'},{status:/not found/i.test(error.message)?404:500,headers:{'cache-control':'no-store'}})}
}

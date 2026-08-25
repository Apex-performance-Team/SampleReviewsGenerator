export const runtime='nodejs';

import{getRun,getRuns}from'../../../../../lib/review-run-store.mjs';
import{buildCatalogResult}from'../../../../../lib/store-review-catalog.mjs';

export async function GET(req,{params}){
  try{
    const{id}=await params,catalog=await getRun(id);if(!catalog.input_json?.catalogRun)throw Error('Catalog workflow not found.');
    if(!['completed','failed'].includes(catalog.status))return Response.json({error:'Catalog workflow is still running.'},{status:409,headers:{'cache-control':'no-store'}});
    const childRunIds=catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||[],children=await getRuns(childRunIds);
    return Response.json({result:buildCatalogResult(catalog,children)},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error.message||'Could not assemble catalog result.'},{status:/still running/i.test(error.message)?409:404,headers:{'cache-control':'no-store'}})}
}

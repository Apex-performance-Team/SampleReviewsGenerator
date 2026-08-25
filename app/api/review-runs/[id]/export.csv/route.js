export const runtime='nodejs';
import{csvForRun}from'../../../../../lib/review-run-engine.mjs';
import{getRun}from'../../../../../lib/review-run-store.mjs';
import{runAccessDenied,runAccessHeaders}from'../../../../../lib/review-run-auth.mjs';

function slug(value){return String(value||'product').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70)||'product'}
export async function GET(req,{params}){
  const denied=runAccessDenied(req);if(denied)return denied;
  try{
    const{id}=await params,run=await getRun(id);
    if(run.status!=='completed')return new Response('Run is not completed yet.',{status:409,headers:runAccessHeaders()});
    return new Response(csvForRun(run),{headers:runAccessHeaders({'content-type':'text/csv;charset=utf-8','content-disposition':`attachment; filename="synthetic-review-run-${slug(run.product_title)}-${run.id.slice(0,8)}.csv"`})});
  }catch(error){return new Response(error.message||'CSV export failed.',{status:404,headers:runAccessHeaders()})}
}

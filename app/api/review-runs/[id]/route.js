export const runtime='nodejs';
import{getRun,runStoreMode}from'../../../../lib/review-run-store.mjs';
import{runAccessDenied,runAccessHeaders}from'../../../../lib/review-run-auth.mjs';

export async function GET(req,{params}){
  const denied=runAccessDenied(req);if(denied)return denied;
  try{const{id}=await params;return Response.json({run:await getRun(id),store:runStoreMode()},{headers:runAccessHeaders()})}
  catch(error){return Response.json({error:error.message||'Run not found.'},{status:404,headers:runAccessHeaders()})}
}

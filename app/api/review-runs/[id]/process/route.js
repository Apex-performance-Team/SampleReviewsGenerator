export const runtime='nodejs';
export const maxDuration=180;

import{processRun}from'../../../../../lib/review-run-engine.mjs';
import{runStoreMode}from'../../../../../lib/review-run-store.mjs';
import{runAccessDenied,runAccessHeaders}from'../../../../../lib/review-run-auth.mjs';

export async function POST(req,{params}){
  const denied=runAccessDenied(req);if(denied)return denied;
  try{const{id}=await params;return Response.json({run:await processRun(req,id),store:runStoreMode()},{headers:runAccessHeaders()})}
  catch(error){return Response.json({error:error.message||'Could not process run.'},{status:500,headers:runAccessHeaders()})}
}

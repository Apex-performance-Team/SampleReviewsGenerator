export const runtime='nodejs';
export const maxDuration=180;

import{processRun}from'../../../../../lib/review-run-engine.mjs';
import{runStoreMode}from'../../../../../lib/review-run-store.mjs';
import{publicRunRateLimit}from'../../../../../lib/public-run-rate-limit.mjs';

export async function POST(req,{params}){
  const limited=publicRunRateLimit(req,{label:'review-run-process',limit:120,windowMs:15*60*1000});if(limited)return limited;
  try{const{id}=await params;return Response.json({run:await processRun(req,id),store:runStoreMode()},{headers:{'cache-control':'no-store'}})}
  catch(error){return Response.json({error:error.message||'Could not process run.'},{status:500,headers:{'cache-control':'no-store'}})}
}

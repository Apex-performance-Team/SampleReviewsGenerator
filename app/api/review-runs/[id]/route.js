export const runtime='nodejs';
import{getRun,runStoreMode}from'../../../../lib/review-run-store.mjs';

export async function GET(req,{params}){
  try{const{id}=await params;return Response.json({run:await getRun(id),store:runStoreMode()},{headers:{'cache-control':'no-store'}})}
  catch(error){return Response.json({error:error.message||'Run not found.'},{status:404,headers:{'cache-control':'no-store'}})}
}

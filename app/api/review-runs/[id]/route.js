import{publicReviewRun}from'../../../../lib/review-result-pages.mjs';
export const runtime='nodejs';
import{getRun,runStoreMode}from'../../../../lib/review-run-store.mjs';

export async function GET(req,{params}){
  try{const{id}=await params;return Response.json({run:publicReviewRun(await getRun(id),new URL(req.url).searchParams.get('offset')),store:runStoreMode()},{headers:{'cache-control':'no-store'}})}
  catch(error){return Response.json({error:error.message||'Run not found.'},{status:404,headers:{'cache-control':'no-store'}})}
}

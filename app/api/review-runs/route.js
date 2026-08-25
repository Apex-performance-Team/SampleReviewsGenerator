export const runtime='nodejs';
export const maxDuration=180;

import{createRun,listRuns,runStoreMode}from'../../../lib/review-run-store.mjs';

function clean(value,max=1000){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function mode(value){return value==='source_rewrite'?'source_rewrite':'pdp_only'}
function inputFrom(body){
  const reviewCount=Number(body.reviewCount),targetAverage=Number(body.targetAverage||4.7);
  if(!Number.isInteger(reviewCount)||reviewCount<5||reviewCount>250)throw Error('Review count must be 5–250.');
  if(!(targetAverage>=1&&targetAverage<=5))throw Error('Target average must be 1–5.');
  const productUrl=clean(body.productUrl,1000),productTitle=clean(body.productTitle,240),productDescription=clean(body.productDescription,9000);
  if(!productUrl&&(!productTitle||!productDescription))throw Error('Provide a product URL or product title/context.');
  return{productUrl,amazonListingUrl:clean(body.amazonListingUrl,1000),productTitle,productDescription,mode:mode(body.mode),reviewCount,targetAverage,referenceBudget:body.referenceBudget||'balanced',references:Array.isArray(body.references)?body.references:undefined};
}
export async function GET(req){
  try{return Response.json({runs:await listRuns(75),store:runStoreMode()},{headers:{'cache-control':'no-store'}})}
  catch(error){return Response.json({error:error.message||'Could not list runs.'},{status:500,headers:{'cache-control':'no-store'}})}
}
export async function POST(req){
  try{const body=await req.json(),run=await createRun(inputFrom(body));return Response.json({run,store:runStoreMode()},{headers:{'cache-control':'no-store'}})}
  catch(error){return Response.json({error:error.message||'Could not create run.'},{status:400,headers:{'cache-control':'no-store'}})}
}

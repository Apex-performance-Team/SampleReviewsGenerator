export const runtime='nodejs';
import{getRun,getRuns}from'../../../../../lib/review-run-store.mjs';
import{buildCatalogResult}from'../../../../../lib/store-review-catalog.mjs';
import{resultPage}from'../../../../../lib/review-result-pages.mjs';

export async function GET(req,{params}){
  try{
    const{id}=await params,catalog=await getRun(id);if(!catalog.input_json?.catalogRun)throw Error('Catalog workflow not found.');
    if(!['completed','failed','canceled'].includes(catalog.status))return Response.json({error:'Catalog workflow is still running.'},{status:409,headers:{'cache-control':'no-store'}});
    const childRunIds=catalog.input_json?.childRunIds||catalog.result_json?.childRunIds||[],query=new URL(req.url).searchParams;
    if(query.has('product')){
      const index=Number(query.get('product'));
      if(!Number.isInteger(index)||index<0||index>=childRunIds.length)throw Error('Product result not found.');
      const child=await getRun(childRunIds[index]),product=buildCatalogResult(catalog,[child]).products[0];
      return Response.json(resultPage(product,query.get('offset')),{headers:{'cache-control':'no-store'}});
    }
    const children=await getRuns(childRunIds,{summaryOnly:true}),result=buildCatalogResult(catalog,children);
    result.totalReviews=children.reduce((n,child)=>n+child.completed_count,0);
    result.products=result.products.map((product,index)=>({...product,reviewCount:children[index].completed_count,finalReviewCount:children[index].completed_count}));
    return Response.json({result,paginated:true},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error.message||'Could not assemble catalog result.'},{status:404,headers:{'cache-control':'no-store'}})}
}

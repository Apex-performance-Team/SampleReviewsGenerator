export const runtime='nodejs';
export const maxDuration=180;

import{gateway}from'../../../lib/gateway';
import{assessReferenceTitleCompatibility}from'../../../lib/reference-title-compatibility.mjs';

function clean(value,max=1000){return String(value||'').replace(/\s+/g,' ').trim().slice(0,max)}
function parseArray(text){const s=String(text||'').replace(/```(?:json)?/gi,'').replace(/```/g,'').trim(),a=s.indexOf('['),b=s.lastIndexOf(']');if(a<0||b<a)throw Error('Rewrite model did not return a JSON array.');return JSON.parse(s.slice(a,b+1))}
function normWords(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(Boolean)}
function exactRunTooClose(a,b,n=7){const A=normWords(a),B=normWords(b);if(A.length<n||B.length<n)return false;const set=new Set();for(let i=0;i<=B.length-n;i++)set.add(B.slice(i,i+n).join(' '));for(let i=0;i<=A.length-n;i++)if(set.has(A.slice(i,i+n).join(' ')))return true;return false}

function safeReferences(values){
  const out=[],seen=new Set();
  for(const raw of Array.isArray(values)?values:[]){
    const referenceId=clean(raw?.referenceId||raw?.sourceReviewId,120),sourceBody=clean(raw?.sourceBody,1800);
    if(!referenceId||sourceBody.length<5||seen.has(referenceId))continue;
    seen.add(referenceId);
    out.push({
      referenceId,
      platform:clean(raw?.platform,80),
      provider:clean(raw?.provider,80),
      sourceUrl:clean(raw?.sourceUrl,1000),
      sourceAsin:clean(raw?.sourceAsin,20),
      sourceListingTitle:clean(raw?.sourceListingTitle,300),
      sourceReviewProductTitle:clean(raw?.sourceReviewProductTitle,300),
      sourceVariantTitle:clean(raw?.sourceVariantTitle,240),
      sourceRating:Number(raw?.sourceRating)||null,
      sourceTitle:clean(raw?.sourceTitle,260),
      sourceBody,
      sourceReviewId:clean(raw?.sourceReviewId,120),
      sourceReviewDate:clean(raw?.sourceReviewDate,160),
      sourceAuthorName:clean(raw?.sourceAuthorName,160),
      sourceVerifiedPurchase:raw?.sourceVerifiedPurchase==null?null:Boolean(raw.sourceVerifiedPurchase),
    });
    if(out.length>=10)break;
  }
  return out;
}

function finalizeReview(item,modelRow,index){
  const title=clean(modelRow?.title,240),body=clean(modelRow?.body,2200);
  if(!title||body.length<5)throw Error(`Rewrite missing valid title/body for ${item.referenceId}.`);
  if(exactRunTooClose(body,item.sourceBody,7))throw Error(`Rewrite for ${item.referenceId} copied a long source phrase.`);
  return{
    id:modelRow?.id?clean(modelRow.id,24):`SRC-${String(index+1).padStart(4,'0')}`,
    rating:item.sourceRating,
    title,
    body,
    referenceId:item.referenceId,
    referencePlatform:item.platform,
    referenceProvider:item.provider,
    referenceSourceUrl:item.sourceUrl,
    referenceSourceAsin:item.sourceAsin,
    referenceSourceListingTitle:item.sourceListingTitle,
    referenceSourceReviewProductTitle:item.sourceReviewProductTitle,
    referenceSourceVariantTitle:item.sourceVariantTitle,
    referenceRating:item.sourceRating,
    referenceSourceTitle:item.sourceTitle,
    referenceSourceBody:item.sourceBody,
    referenceSourceReviewId:item.sourceReviewId,
    referenceSourceVerifiedPurchase:item.sourceVerifiedPurchase,
    referenceSourceReviewDate:item.sourceReviewDate,
    referenceSourceAuthorName:item.sourceAuthorName,
    referenceLed:true,
    generationLane:'source_rewrite_simple',
    rewriteStatus:'accepted',
    syntheticFixture:true,
    publicationAllowed:false,
    fixtureType:'synthetic_review_qa',
  };
}

export async function POST(req){
  try{
    const input=await req.json(),productTitle=clean(input?.productTitle,240),productDescription=clean(input?.productDescription,9000),references=safeReferences(input?.references);
    if(!productTitle||!productDescription)throw Error('Product title and PDP facts are required.');
    if(!references.length)throw Error('At least one source review is required.');
    const rejected=[],accepted=[];
    for(const reference of references){
      const compatibility=assessReferenceTitleCompatibility(productTitle,reference);
      if(!compatibility.accepted)rejected.push({...reference,rewriteStatus:'rejected',rejectReason:`product_mismatch: ${compatibility.reason}`,compatibility});
      else accepted.push(reference);
    }
    let reviews=[];
    if(accepted.length){
      const prompt=`Rewrite pulled ecommerce reviews into synthetic QA fixtures. Return ONLY a JSON array.

PRODUCT TITLE:
${productTitle}

HARD PDP FACTS ONLY FOR CONTRADICTION CHECKING:
${productDescription}

SOURCE REVIEWS:
${JSON.stringify(accepted.map((x,index)=>({id:`SRC-${String(index+1).padStart(4,'0')}`,referenceId:x.referenceId,rating:x.sourceRating,title:x.sourceTitle,body:x.sourceBody,sourceReviewProductTitle:x.sourceReviewProductTitle,sourceVariantTitle:x.sourceVariantTitle})))}

RULES:
- Rewrite what is there. Do not create a new story.
- Keep the same rating sentiment.
- Keep the same complaint, praise, result, and experience type.
- Change the wording enough that it is not copied.
- Keep it natural, like a normal Amazon buyer.
- Use first person if the source uses or implies first person.
- Only remove or generalize details that contradict the PRODUCT TITLE or HARD PDP FACTS.
- Do not add personas, themes, household stories, gift stories, support stories, price logic, buyer advice, listing confusion, or new product claims.
- Do not improve the source review into a more complete review. If it is short, keep it short.
- Do not explain what the product category is.

For every SOURCE REVIEW return exactly:
{"id":"SRC-0001","referenceId":"...","title":"rewritten title","body":"rewritten body"}`;
      const model=await gateway(req,prompt,115000),arr=parseArray(model.text),byRef=new Map(arr.map(x=>[clean(x?.referenceId,120),x]));
      reviews=[];
      accepted.forEach((item,index)=>{
        try{reviews.push(finalizeReview(item,byRef.get(item.referenceId),index))}
        catch(e){rejected.push({...item,rewriteStatus:'rejected',rejectReason:`rewrite_failed: ${clean(e?.message||e,260)}`})}
      });
    }
    return Response.json({productTitle,mode:'source_rewrite_simple',inputCount:references.length,acceptedCount:accepted.length,rejectedCount:rejected.length,reviews,rejected,synthetic:true,publicationAllowed:false,datasetPurpose:'internal_qa_modeling'},{headers:{'cache-control':'no-store'}});
  }catch(error){return Response.json({error:error?.message||'Simple source rewrite failed.'},{status:500,headers:{'cache-control':'no-store'}})}
}

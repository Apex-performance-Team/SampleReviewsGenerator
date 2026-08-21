export const runtime='nodejs';
export const maxDuration=300;

import{POST as v11POST}from'../reference-scan-v11/route';
import{discoverAmazonVolumeCandidates}from'../../../lib/amazon-volume-discovery-v2';

function cloneHeaders(h){const out=new Headers();for(const [k,v] of h.entries())out.set(k,v);return out}
function sourceRow(c){return{platform:'amazon.com',provider:'bright_data_amazon_search',sourceUrl:c.url,directSourceUrl:c.url,asin:c.asin,title:c.title||'Amazon',status:'aggregate_only',matchConfidence:Number((c.verificationConfidence||0).toFixed(3)),confidence:(c.verificationConfidence||0)>=.82?'high':'medium',publicReviewCount:c.ratingCount??null,countKind:c.ratingCount!=null?'amazon_search':null,extractedReviewCount:0,individualExtractedCount:0,pageCount:1,aggregateOnly:true,ratingEstimate:c.rating??null,error:null,linkVerified:true,linkVerification:'amazon_search+identity_verification',lensTabs:['amazon_search_fallback'],lensRank:null,verificationMethod:'amazon_search+identity_verification',verificationReason:c.verificationReason||null,discoveryOrigin:'amazon_high_volume'}}
function emptyReferenceSet(body,baseError){return{version:'individual-reference-v12',provider:'amazon_fallback_after_lens_error',productUrl:String(body?.productUrl||''),productTitle:String(body?.productTitle||''),productDescription:String(body?.productDescription||''),references:[],sourceCounts:[],aggregateOnlySources:[],platformCounts:[],totalIndividualReviews:0,availableForGeneration:0,confidence:'none',matchedPages:0,verifiedSourceLinks:0,lensDiscovery:{enabled:true,status:'failed',error:baseError||null},provenance:{lensFailed:true,amazonFallbackAttempted:true},syntheticUseOnly:true,sourceReviewTextExported:false}}

async function amazonFallback(req,body,rs,baseError){
  const discoveryInput={...(rs||{}),productDescription:body.productDescription||rs?.productDescription||'',productTitle:body.productTitle||rs?.productTitle||'',productUrl:body.productUrl||rs?.productUrl||''};
  let discovery;try{discovery=await discoverAmazonVolumeCandidates(req,discoveryInput)}catch(e){discovery={candidates:[],queries:[],diagnostics:{error:e?.message||String(e)}}}
  const candidates=discovery.candidates||[],baseRs=rs||emptyReferenceSet(body,baseError),identityTitle=discovery.identity?.title||baseRs.productTitle;
  if(!candidates.length)return Response.json({referenceSet:{...baseRs,productTitle:identityTitle,productDescription:discoveryInput.productDescription,amazonFallbackDiscovery:{status:'no_verified_candidate',baseLensError:baseError||null,queries:discovery.queries||[],identity:discovery.identity||null,diagnostics:discovery.diagnostics||{}}}},{headers:{'cache-control':'no-store'}});
  const rows=candidates.map(sourceRow),aggregate=rows.map(x=>({platform:x.platform,provider:x.provider,sourceUrl:x.sourceUrl,directSourceUrl:x.directSourceUrl,asin:x.asin,sameProductConfidence:x.matchConfidence,reviewCountEstimate:x.publicReviewCount,ratingEstimate:x.ratingEstimate,lensTabs:x.lensTabs,verificationMethod:x.verificationMethod}));
  const out={...baseRs,productTitle:identityTitle,productDescription:discoveryInput.productDescription,sourceCounts:rows,aggregateOnlySources:aggregate,confidence:rows.some(x=>x.confidence==='high')?'high':'medium',matchedPages:rows.length,verifiedSourceLinks:rows.length,amazonFallbackDiscovery:{status:'verified',baseLensError:baseError||null,queries:discovery.queries||[],identity:discovery.identity||null,diagnostics:discovery.diagnostics||{},candidates:candidates.map(c=>({asin:c.asin,url:c.url,title:c.title,ratingCount:c.ratingCount,verificationConfidence:c.verificationConfidence,verificationRelation:c.verificationRelation,verificationReason:c.verificationReason}))},provenance:{...(baseRs.provenance||{}),amazonFallbackUsed:true,amazonFallbackCandidates:rows.length}};
  return Response.json({referenceSet:out},{headers:{'cache-control':'no-store'}})
}

export async function POST(req){
  let body;try{body=await req.json()}catch{return Response.json({error:'Invalid JSON body.'},{status:400})}
  if(body?._lensUnavailableReason)return amazonFallback(req,body,null,String(body._lensUnavailableReason));
  const forwarded=new Request(req.url,{method:'POST',headers:cloneHeaders(req.headers),body:JSON.stringify(body)});
  let baseRes,base;try{baseRes=await v11POST(forwarded);try{base=await baseRes.clone().json()}catch{base=null}}catch(e){return amazonFallback(req,body,null,e?.message||String(e))}
  if(!baseRes.ok)return amazonFallback(req,body,null,base?.error||`Lens HTTP ${baseRes.status}`);
  const rs=base?.referenceSet;if(!rs)return amazonFallback(req,body,null,'Lens response contained no referenceSet.');
  if((rs.sourceCounts||[]).length)return baseRes;
  return amazonFallback(req,body,rs,null)
}

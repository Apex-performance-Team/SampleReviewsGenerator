export const runtime='nodejs';
export const maxDuration=180;

import{ingestMarketplaceSource}from'../../../lib/marketplace-review-ingest';
import{collectAmazonReviewsV2,isAmazonV2}from'../../../lib/amazon-review-ingest-v2';

function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function hash(s){let h=2166136261;for(let i=0;i<String(s).length;i++){h^=String(s).charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0).toString(36).toUpperCase()}
function sent(s){return Math.max(1,(String(s).match(/[.!?]+(?:\s|$)/g)||[]).length)}
function recomputePlatformCounts(refs){const m=new Map();for(const r of refs||[]){const k=`${r.platform}|${r.provider||''}`,x=m.get(k)||{platform:r.platform,provider:r.provider,reviewCount:0,pages:new Set()};x.reviewCount++;x.pages.add(r.sourceUrl);m.set(k,x)}return[...m.values()].map(x=>({platform:x.platform,provider:x.provider,reviewCount:x.reviewCount,pageCount:x.pages.size})).sort((a,b)=>b.reviewCount-a.reviewCount)}
function marketplaceSources(rs){const map=new Map();for(const x of[...(rs?.sourceCounts||[]),...(rs?.aggregateOnlySources||[])]){const u=x?.directSourceUrl||x?.sourceUrl||'',h=host(u);if(!u||(!/(^|\.)amazon\./i.test(h)&&!/(^|\.)ebay\./i.test(h)))continue;if(!map.has(u))map.set(u,x)}return[...map.values()].slice(0,8)}

export async function POST(req){
  let body;try{body=await req.json()}catch{return Response.json({error:'Invalid JSON body.'},{status:400})}
  const rs=body?.referenceSet;if(!rs||!Array.isArray(rs.references))return Response.json({error:'referenceSet is required.'},{status:400});
  const sources=marketplaceSources(rs);if(!sources.length)return Response.json({referenceSet:{...rs,marketplaceIngestion:{attemptedSources:0,appendedReviews:0,sources:[]}}},{headers:{'cache-control':'no-store'}});
  const existing=new Set((rs.references||[]).map(r=>clean(r.sourceBody).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()).filter(Boolean));
  const remaining=Math.max(1,250-(rs.references||[]).length);
  const diagnostics=[],appended=[];
  const results=await Promise.all(sources.map(async src=>{try{const u=src?.directSourceUrl||src?.sourceUrl||'';const result=isAmazonV2(u)?await collectAmazonReviewsV2(src,{maxReviews:remaining}):await ingestMarketplaceSource(src,{maxPages:3,maxReviews:remaining});return{src,result}}catch(e){return{src,result:{reviews:[],provider:null,attempted:0,blocked:0,failed:1,error:clean(e?.message||e)}}}}));
  const sourceCounts=[...(rs.sourceCounts||[])],aggregateOnly=[...(rs.aggregateOnlySources||[])];
  for(const {src,result} of results){
    const sourceUrl=src.directSourceUrl||src.sourceUrl||'',platform=host(sourceUrl)||src.platform||'',provider=result.provider||src.provider||'marketplace';let added=0;
    for(const r of result.reviews||[]){const bodyText=clean(r.body),k=bodyText.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(!k||existing.has(k)||appended.length>=remaining)continue;existing.add(k);appended.push({referenceId:`REF-${hash(`${sourceUrl}|${bodyText}`).slice(0,8)}`,platform,provider,sourceUrl,sourceRating:r.rating??null,sourceTitle:clean(r.title).slice(0,220),sourceBody:bodyText,sourceReviewId:r.reviewId||'',sourceVerifiedPurchase:Boolean(r.verifiedPurchase),sourceReviewDate:r.reviewDate||null,wordCount:bodyText.split(/\s+/).filter(Boolean).length,sentenceCount:sent(bodyText)});added++}
    let row=sourceCounts.find(x=>(x.directSourceUrl||x.sourceUrl)===sourceUrl);if(added&&!row){row={...src,directSourceUrl:sourceUrl,sourceUrl:src.sourceUrl||sourceUrl,aggregateOnly:false,status:'found'};sourceCounts.push(row)}
    if(row&&added){row.individualExtractedCount=(Number(row.individualExtractedCount)||Number(row.extractedReviewCount)||Number(row.reviewCount)||0)+added;row.extractedReviewCount=row.individualExtractedCount;row.reviewCount=row.individualExtractedCount;row.aggregateOnly=false;row.provider=provider;row.status='found'}
    diagnostics.push({sourceUrl,platform,provider,attempted:result.attempted||0,blocked:result.blocked||0,failed:result.failed||0,pending:Boolean(result.pending),snapshotId:result.snapshotId||null,canonicalUrl:result.canonicalUrl||null,requested:result.requested??null,rawRows:result.rawRows??null,parsedBodies:result.parsedBodies??null,reviewIdCount:result.reviewIdCount??null,rowKeys:result.rowKeys||null,extracted:added,error:result.error||''});
  }
  const references=[...(rs.references||[]),...appended].slice(0,250),active=new Set(references.map(r=>r.sourceUrl));
  const out={...rs,references,sourceCounts,aggregateOnlySources:aggregateOnly.filter(x=>!active.has(x.directSourceUrl||x.sourceUrl)),platformCounts:recomputePlatformCounts(references),totalIndividualReviews:references.length,availableForGeneration:Math.min(250,references.length),matchedPages:sourceCounts.length,verifiedSourceLinks:sourceCounts.filter(x=>x.linkVerified).length,marketplaceIngestion:{attemptedSources:sources.length,appendedReviews:appended.length,sources:diagnostics}};
  return Response.json({referenceSet:out},{headers:{'cache-control':'no-store'}})
}

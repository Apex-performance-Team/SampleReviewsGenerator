export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';

import{POST as scanPOST}from'../reference-scan/route.js';
import{POST as enrichPOST}from'../reference-enrich-marketplaces/route.js';

const PRODUCT={
  productUrl:'https://instabeamtv.com/products/outdoor-omni-antenna-2',
  productTitle:'InstaBeam OmniReach Extended Range TV Antenna',
  productDescription:'Outdoor omni-directional HDTV antenna for receiving over-the-air television channels with extended range reception.',
  existingReviewCount:0,
  originalReviewCount:0,
  targetSourceCount:5,
  targetReferenceCount:250
};

function clean(x){return String(x??'').replace(/\s+/g,' ').trim()}
function bodyKey(s){return clean(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function exportReferences(set){return Array.isArray(set?.pulledReferences)&&set.pulledReferences.length?set.pulledReferences:Array.isArray(set?.references)?set.references:[]}
function sourceKey(r){return `${r?.sourceUrl||''}|${r?.sourceReviewId||''}|${bodyKey(r?.sourceBody||'')}`}
function csvCell(v){const s=Array.isArray(v)?v.join('|'):v==null?'':String(v);return `"${s.replace(/"/g,'""')}"`}
function csvRows(set){const sources=Array.isArray(set?.sourceCounts)?set.sourceCounts:[],byUrl=new Map();for(const s of sources)for(const u of[s.directSourceUrl,s.sourceUrl])if(u)byUrl.set(String(u),s);return exportReferences(set).map((r,i)=>{const src=byUrl.get(String(r.sourceUrl||''))||{};return{reference_index:i+1,source_platform:r.platform||src.platform||'',review_provider:r.provider||src.provider||'',source_listing_url:r.sourceUrl||src.directSourceUrl||src.sourceUrl||'',source_listing_title:src.title||'',asin:r.sourceAsin||src.asin||'',source_rating:r.sourceRating??'',source_review_id:r.sourceReviewId||'',source_verified_purchase:Boolean(r.sourceVerifiedPurchase),source_review_date:r.sourceReviewDate||'',source_author_name:r.sourceAuthorName||'',review_title:r.sourceTitle||'',review_body:r.sourceBody||'',public_review_count:src.publicReviewCount??'',listing_status:src.status||'',scrape_error:src.error||''}})}
function asCsv(set){const headers=['reference_index','source_platform','review_provider','source_listing_url','source_listing_title','asin','source_rating','source_review_id','source_verified_purchase','source_review_date','source_author_name','review_title','review_body','public_review_count','listing_status','scrape_error'],rows=csvRows(set);return '\ufeff'+[headers.map(csvCell).join(','),...rows.map(r=>headers.map(h=>csvCell(r[h])).join(','))].join('\r\n')}
function summarizeSources(set){return(set?.sourceCounts||[]).slice(0,20).map(s=>({platform:s.platform||null,provider:s.provider||null,asin:s.asin||null,title:clean(s.title).slice(0,180),publicReviewCount:s.publicReviewCount??null,individualExtractedCount:s.individualExtractedCount??s.extractedReviewCount??s.reviewCount??0,status:s.status||null,error:s.error||null,url:s.directSourceUrl||s.sourceUrl||null,matchConfidence:s.matchConfidence??s.sameProductConfidence??null,verificationMethod:s.verificationMethod||s.linkVerification||null,discoveryOrigin:s.discoveryOrigin||null}))}
function summarizeMarketplace(set){const m=set?.marketplaceIngestion||{};return{attemptedSources:m.attemptedSources??0,verifiedAmazonSources:m.verifiedAmazonSources??0,pulledReviews:m.pulledReviews??0,totalPulledReviews:m.totalPulledReviews??0,cumulative:m.cumulative||null,pass:m.pass||null,budget:m.budget?{hardCap:m.budget.hardCap,targetReviews:m.budget.targetReviews,remainingCapacity:m.budget.remainingCapacity,passPlanned:m.budget.passPlanned,passFulfilled:m.budget.passFulfilled,passShortfall:m.budget.passShortfall,strategy:m.budget.strategy,sourceQueue:(m.budget.sourceQueue||[]).slice(0,10)}:null,sources:(m.sources||[]).slice(0,10).map(s=>({sourceUrl:s.sourceUrl,asin:s.asin,provider:s.provider,type:s.type,plannedRank:s.plannedRank,plannedReviewCount:s.plannedReviewCount,budget:s.budget,maxBatches:s.maxBatches,uniqueBodies:s.uniqueBodies,excludedReviewIds:s.excludedReviewIds,attempted:s.attempted,failed:s.failed,pending:s.pending,requested:s.requested,aggregateRatingCount:s.aggregateRatingCount,rawRows:s.rawRows,parsedBodies:s.parsedBodies,reviewIdCount:s.reviewIdCount,pulled:s.pulled,existing:s.existing,total:s.total,error:s.error}))}}
async function jsonFrom(res){try{return await res.json()}catch{return null}}

export async function GET(req){
  const url=new URL(req.url),target=Math.max(1,Math.min(50,Number(url.searchParams.get('target')||50))),format=String(url.searchParams.get('format')||'json').toLowerCase();
  if(url.searchParams.get('run')!=='paid')return Response.json({ok:true,live:false,message:'OmniReach 50 selftest is idle. Add ?run=paid to trigger one paid Bright Data Lens/Amazon run.',target,product:PRODUCT},{headers:{'cache-control':'no-store'}});
  const started=Date.now(),headers=new Headers(req.headers);headers.set('content-type','application/json');
  const scanReq=new Request(new URL('/api/reference-scan',req.url),{method:'POST',headers,body:JSON.stringify({...PRODUCT,referenceBudget:url.searchParams.get('budget')||'balanced'})});
  const scanRes=await scanPOST(scanReq),scan=await jsonFrom(scanRes);
  if(!scanRes.ok||!scan?.referenceSet)return Response.json({ok:false,stage:'reference_scan',status:scanRes.status,error:scan?.error||'referenceSet missing',diagnostics:scan?.diagnostics||null,brightData:scan?.brightData||null,elapsedMs:Date.now()-started},{status:scanRes.status||500,headers:{'cache-control':'no-store'}});
  let current=scan.referenceSet,passes=[];
  for(let pass=1;pass<=4;pass++){
    const before=exportReferences(current).length,remaining=Math.max(0,target-before);if(remaining<=0)break;
    const enrichReq=new Request(new URL('/api/reference-enrich-marketplaces',req.url),{method:'POST',headers,body:JSON.stringify({referenceSet:current,maxMarketplaceReviews:remaining,marketplaceTargetReviews:target,targetSourceCount:5})});
    const enrichRes=await enrichPOST(enrichReq),enrich=await jsonFrom(enrichRes);
    if(!enrichRes.ok||!enrich?.referenceSet){passes.push({pass,status:enrichRes.status,error:enrich?.error||'referenceSet missing'});break}
    current=enrich.referenceSet;
    const after=exportReferences(current).length,added=after-before,ing=current.marketplaceIngestion||{};
    passes.push({pass,before,after,added,remainingAfter:Math.max(0,target-after),marketplace:summarizeMarketplace(current)});
    if(added<=0)break;
  }
  const refs=exportReferences(current),uniqueBodies=new Set(refs.map(r=>bodyKey(r.sourceBody)).filter(Boolean)),uniqueRows=new Set(refs.map(sourceKey).filter(Boolean)),sourceUrls=new Set(refs.map(r=>String(r.sourceUrl||'')).filter(Boolean)),result={ok:uniqueBodies.size>=target&&uniqueRows.size>=target,target,reviewRows:refs.length,uniqueBodyCount:uniqueBodies.size,uniqueRowCount:uniqueRows.size,uniqueSourceUrlCount:sourceUrls.size,usableReviewSources:current.usableReviewSources??null,totalIndividualReviews:current.totalIndividualReviews??null,totalPulledReviews:current.totalPulledReviews??null,sourceGate:current.sourceGate||null,sourceCounts:summarizeSources(current),marketplaceIngestion:summarizeMarketplace(current),passes,elapsedMs:Date.now()-started,product:{url:current.productUrl,title:current.productTitle},referenceSet:format==='full'?current:undefined};
  if(format==='csv')return new Response(asCsv(current),{status:200,headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="omnireach-50-selftest-${result.uniqueRowCount}.csv"`,'cache-control':'no-store','x-selftest-ok':String(result.ok),'x-selftest-unique-rows':String(result.uniqueRowCount),'x-selftest-unique-bodies':String(result.uniqueBodyCount)}});
  return Response.json(result,{status:result.ok?200:502,headers:{'cache-control':'no-store'}});
}

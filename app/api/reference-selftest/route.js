export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';

const PDP='https://instabeamtv.com/products/premium-antenna-1';
function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function summarize(rs){const refs=Array.isArray(rs?.references)?rs.references:[],sources=[...(rs?.sourceCounts||[]),...(rs?.aggregateOnlySources||[])],marketRefs=refs.filter(r=>/(^|\.)(amazon|ebay)\./i.test(host(r.sourceUrl))),amazon=marketRefs.filter(r=>/(^|\.)amazon\./i.test(host(r.sourceUrl))),ebay=marketRefs.filter(r=>/(^|\.)ebay\./i.test(host(r.sourceUrl)));return{totalReferences:refs.length,marketplaceReferences:marketRefs.length,amazonReferences:amazon.length,ebayReferences:ebay.length,referenceHosts:[...new Set(refs.map(r=>host(r.sourceUrl)).filter(Boolean))],sourceHosts:[...new Set(sources.map(s=>host(s.directSourceUrl||s.sourceUrl)).filter(Boolean))],amazonSources:sources.filter(s=>/(^|\.)amazon\./i.test(host(s.directSourceUrl||s.sourceUrl))).map(s=>({url:s.directSourceUrl||s.sourceUrl,asin:s.asin||null,publicReviewCount:s.publicReviewCount??s.reviewCountEstimate??null,individualExtractedCount:s.individualExtractedCount??s.extractedReviewCount??s.reviewCount??0,aggregateOnly:Boolean(s.aggregateOnly)})),ebaySources:sources.filter(s=>/(^|\.)ebay\./i.test(host(s.directSourceUrl||s.sourceUrl))).map(s=>({url:s.directSourceUrl||s.sourceUrl,publicReviewCount:s.publicReviewCount??s.reviewCountEstimate??null,individualExtractedCount:s.individualExtractedCount??s.extractedReviewCount??s.reviewCount??0,aggregateOnly:Boolean(s.aggregateOnly)})),marketplaceIngestion:rs?.marketplaceIngestion||null}}
async function postJson(url,body,timeout){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-reference-selftest':'1'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(timeout)}),raw=await r.text();let j;try{j=JSON.parse(raw)}catch{j={error:`Invalid JSON from ${url}: ${raw.slice(0,500)}`}}return{r,j}}

export async function GET(req){
  const started=Date.now(),origin=new URL(req.url).origin;
  try{
    const {r:scanRes,j:scanJson}=await postJson(`${origin}/api/scan`,{url:PDP},90000);
    if(!scanRes.ok)return Response.json({ok:false,stage:'pdp_scan',status:scanRes.status,error:scanJson?.error||'PDP scan failed',elapsedMs:Date.now()-started},{status:500,headers:{'cache-control':'no-store'}});

    const {r:refRes,j:refJson}=await postJson(`${origin}/api/reference-scan`,{...scanJson,targetReferenceCount:250,originalReviewCount:scanJson?.extracted?.existingReviewCount??null},210000);
    if(!refRes.ok)return Response.json({ok:false,stage:'reference_scan',status:refRes.status,error:refJson?.error||'Reference scan failed',diagnostics:refJson?.diagnostics||null,elapsedMs:Date.now()-started},{status:500,headers:{'cache-control':'no-store'}});
    const baseline=refJson.referenceSet;

    const {r:enrichRes,j:enrichJson}=await postJson(`${origin}/api/reference-enrich-marketplaces`,{referenceSet:baseline},180000);
    if(!enrichRes.ok)return Response.json({ok:false,stage:'marketplace_enrichment',status:enrichRes.status,error:enrichJson?.error||'Marketplace enrichment failed',baseline:summarize(baseline),details:enrichJson,elapsedMs:Date.now()-started},{status:500,headers:{'cache-control':'no-store'}});
    const enriched=enrichJson.referenceSet;
    const before=summarize(baseline),after=summarize(enriched),pass=after.totalReferences>=before.totalReferences&&after.marketplaceReferences>0;
    return Response.json({ok:pass,stage:pass?'pass':'marketplace_reviews_missing',pdp:{url:scanJson.productUrl,title:scanJson.productTitle,existingReviewCount:scanJson?.extracted?.existingReviewCount??null},baseline:before,enriched:after,checks:{corpusNeverShrank:after.totalReferences>=before.totalReferences,marketplaceBodiesExtracted:after.marketplaceReferences>0,amazonBodiesExtracted:after.amazonReferences>0,ebayBodiesExtracted:after.ebayReferences>0},elapsedMs:Date.now()-started},{status:pass?200:500,headers:{'cache-control':'no-store'}})
  }catch(e){return Response.json({ok:false,stage:'exception',error:e?.message||String(e),elapsedMs:Date.now()-started},{status:500,headers:{'cache-control':'no-store'}})}
}

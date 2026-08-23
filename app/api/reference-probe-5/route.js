export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';

const PDP='https://instabeamtv.com/products/outdoor-omni-antenna-2';

function host(x){try{return new URL(x).hostname.replace(/^www\./,'').toLowerCase()}catch{return''}}
function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function sourceSummary(x){const u=x?.directSourceUrl||x?.sourceUrl||'';return{host:host(u),url:u,platform:x?.platform||null,provider:x?.provider||null,asin:x?.asin||null,title:clean(x?.title).slice(0,180)||null,confidence:x?.confidence||x?.matchConfidence||x?.sameProductConfidence||null,aggregateOnly:Boolean(x?.aggregateOnly),individualExtractedCount:x?.individualExtractedCount??x?.extractedReviewCount??x?.reviewCount??0,publicReviewCount:x?.publicReviewCount??x?.reviewCountEstimate??null,linkVerified:x?.linkVerified??null,verificationMethod:x?.verificationMethod||x?.linkVerification||null,discoveryOrigin:x?.discoveryOrigin||null,lensTabs:Array.isArray(x?.lensTabs)?x.lensTabs.slice(0,4):[]}}
function summarizeReferenceSet(rs){const sourceCounts=Array.isArray(rs?.sourceCounts)?rs.sourceCounts:[],aggregateOnly=Array.isArray(rs?.aggregateOnlySources)?rs.aggregateOnlySources:[],sources=[...sourceCounts,...aggregateOnly];return{provider:rs?.provider||null,productTitle:rs?.productTitle||null,referenceBudget:rs?.referenceBudget||null,targetSourceCount:rs?.targetSourceCount??null,totalSources:sources.length,sourceCounts:sourceCounts.length,aggregateOnlySources:aggregateOnly.length,totalIndividualReviews:rs?.totalIndividualReviews??0,totalPulledReviews:rs?.totalPulledReviews??0,availableForGeneration:rs?.availableForGeneration??0,confidence:rs?.confidence||null,lensDiscovery:{status:rs?.lensDiscovery?.status||null,transport:rs?.lensDiscovery?.transport||null,requests:rs?.lensDiscovery?.requests??rs?.lensDiscovery?.lensRequests??null,succeeded:rs?.lensDiscovery?.succeeded??null,failed:rs?.lensDiscovery?.failed??null,rawResults:rs?.lensDiscovery?.rawResults??null,uniqueCandidates:rs?.lensDiscovery?.uniqueCandidates??null,acceptedCandidates:rs?.lensDiscovery?.acceptedCandidates??rs?.lensDiscovery?.verifiedAcceptedCandidates??null,amazonCandidates:rs?.lensDiscovery?.amazonCandidates??null,amazonAccepted:rs?.lensDiscovery?.amazonAccepted??null},provenance:rs?.provenance||null,sources:sources.map(sourceSummary)}}
async function jsonFromResponse(res){const raw=await res.text();try{return JSON.parse(raw)}catch{return{error:`Invalid JSON: ${raw.slice(0,500)}`}}}

export async function GET(req){
  const started=Date.now();
  try{
    const scanMod=await import('../scan/route.js');
    const scanReq=new Request(new URL('/api/scan',req.url),{method:'POST',headers:req.headers,body:JSON.stringify({url:PDP,deferReferenceScan:true})});
    const scanRes=await scanMod.POST(scanReq),scanJson=await jsonFromResponse(scanRes);
    if(!scanRes.ok)return Response.json({ok:false,stage:'pdp_scan',status:scanRes.status,error:scanJson?.error||'PDP scan failed',elapsedMs:Date.now()-started},{status:500,headers:{'cache-control':'no-store'}});

    const refMod=await import('../reference-scan/route.js');
    const body={...scanJson,referenceBudget:'test',targetSourceCount:5,targetReferenceCount:250,originalReviewCount:scanJson?.extracted?.existingReviewCount??null};
    const refReq=new Request(new URL('/api/reference-scan',req.url),{method:'POST',headers:req.headers,body:JSON.stringify(body)});
    const refRes=await refMod.POST(refReq),refJson=await jsonFromResponse(refRes);
    if(!refRes.ok)return Response.json({ok:false,stage:'reference_scan',status:refRes.status,code:refJson?.code||null,error:refJson?.error||'Reference scan failed',diagnosticId:refJson?.diagnosticId||null,brightData:refJson?.brightData||null,diagnostics:refJson?.diagnostics||null,pdp:{url:scanJson.productUrl,title:scanJson.productTitle,existingReviewCount:scanJson?.extracted?.existingReviewCount??null},elapsedMs:Date.now()-started},{status:500,headers:{'cache-control':'no-store'}});

    const referenceSet=refJson.referenceSet||null,summary=summarizeReferenceSet(referenceSet);
    const pass=summary.totalSources>=5&&summary.lensDiscovery.status==='complete'&&!summary.provenance?.lensFailed;
    return Response.json({ok:pass,stage:pass?'pass':'source_count_shortfall',pdp:{url:scanJson.productUrl,title:scanJson.productTitle,existingReviewCount:scanJson?.extracted?.existingReviewCount??null,cleanup:scanJson?.extracted?.cleanup||null},summary,elapsedMs:Date.now()-started},{status:pass?200:500,headers:{'cache-control':'no-store'}});
  }catch(e){return Response.json({ok:false,stage:'exception',error:e?.message||String(e),elapsedMs:Date.now()-started},{status:500,headers:{'cache-control':'no-store'}})}
}

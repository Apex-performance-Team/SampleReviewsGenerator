export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';

const PDP='https://instabeamtv.com/products/outdoor-omni-antenna-2';

function pickReferenceSummary(referenceSet){
  const rs=referenceSet||{},lens=rs.lensDiscovery||{},prov=rs.provenance||{};
  return{
    provider:rs.provider||null,
    referenceBudget:rs.referenceBudget?.id||rs.referenceBudget||null,
    targetSourceCount:rs.targetSourceCount??lens.targetSourceCount??null,
    totalSources:(rs.sourceCounts||[]).length,
    aggregateOnlySources:(rs.aggregateOnlySources||[]).length,
    totalIndividualReviews:rs.totalIndividualReviews??null,
    totalPulledReviews:rs.totalPulledReviews??null,
    availableForGeneration:rs.availableForGeneration??null,
    confidence:rs.confidence||null,
    lensDiscovery:{
      status:lens.status||null,
      transport:lens.transport||null,
      requests:lens.requests??lens.lensRequests??prov.lensRequests??null,
      succeeded:lens.succeeded??prov.lensRequestsSucceeded??null,
      failed:lens.failed??null,
      rawResults:lens.rawResults??prov.lensRawResults??null,
      uniqueCandidates:lens.uniqueCandidates??prov.lensUniqueCandidates??null,
      acceptedCandidates:lens.acceptedCandidates??lens.verifiedAcceptedCandidates??prov.selectedSources??null,
      amazonCandidates:lens.amazonCandidates??null,
      amazonAccepted:lens.amazonAccepted??null
    },
    provenance:{
      imagesScanned:prov.imagesScanned??null,
      heroImageUrl:prov.heroImageUrl||null,
      lensRequests:prov.lensRequests??null,
      lensRequestsSucceeded:prov.lensRequestsSucceeded??null,
      lensRawResults:prov.lensRawResults??null,
      lensUniqueCandidates:prov.lensUniqueCandidates??null,
      verifiedCandidates:prov.verifiedCandidates??null,
      selectedSources:prov.selectedSources??null,
      reviewSources:prov.reviewSources??null,
      durationMs:prov.durationMs??null,
      amazonFallbackUsed:Boolean(prov.amazonFallbackUsed),
      diagnosticId:prov.diagnosticId||null,
      imageTransport:prov.imageTransport||null
    },
    sourceCounts:(rs.sourceCounts||[]).map(x=>({
      platform:x.platform,
      provider:x.provider,
      sourceUrl:x.sourceUrl,
      asin:x.asin||null,
      title:x.title||null,
      status:x.status||null,
      matchConfidence:x.matchConfidence??null,
      confidence:x.confidence||null,
      publicReviewCount:x.publicReviewCount??null,
      extractedReviewCount:x.extractedReviewCount??null,
      aggregateOnly:Boolean(x.aggregateOnly),
      lensTabs:x.lensTabs||null,
      verificationMethod:x.verificationMethod||null,
      error:x.error||null
    }))
  };
}

export async function GET(req){
  const started=Date.now();
  try{
    const scanMod=await import('../scan/route.js');
    const refMod=await import('../reference-scan/route.js');
    const scanReq=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify({url:PDP,deferReferenceScan:true})});
    const scanRes=await scanMod.POST(scanReq),scanJson=await scanRes.json().catch(()=>({error:'scan_non_json'}));
    if(!scanRes.ok)return Response.json({ok:false,stage:'pdp_scan_failed',status:scanRes.status,pdpUrl:PDP,scan:scanJson,durationMs:Date.now()-started},{headers:{'cache-control':'no-store'}});
    const refBody={
      productUrl:scanJson.productUrl||PDP,
      productTitle:scanJson.productTitle,
      productDescription:scanJson.productDescription,
      originalReviewCount:scanJson.extracted?.existingReviewCount??null,
      referenceBudget:'test',
      targetSourceCount:5,
      targetReferenceCount:250,
      skipMarketplaceEnrichment:true
    };
    const refReq=new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify(refBody)});
    const refRes=await refMod.POST(refReq),refJson=await refRes.json().catch(()=>({error:'reference_non_json'}));
    const summary=pickReferenceSummary(refJson.referenceSet);
    const totalSources=summary.totalSources||0;
    return Response.json({
      ok:refRes.ok&&totalSources>=5,
      stage:refRes.ok?(totalSources>=5?'complete':'source_count_shortfall'):(refJson.code||'reference_scan_failed'),
      status:refRes.status,
      pdp:{url:scanJson.productUrl,title:scanJson.productTitle,existingReviewCount:scanJson.extracted?.existingReviewCount??null,cleanup:scanJson.extracted?.cleanup||null},
      referenceSummary:summary,
      referenceError:refRes.ok?null:refJson,
      durationMs:Date.now()-started
    },{headers:{'cache-control':'no-store'}});
  }catch(e){
    return Response.json({ok:false,stage:'probe_exception',error:e?.message||String(e),durationMs:Date.now()-started},{headers:{'cache-control':'no-store'}});
  }
}

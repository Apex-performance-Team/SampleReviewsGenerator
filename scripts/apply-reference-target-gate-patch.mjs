import fs from'node:fs';

function patchFile(path,patches){
  let text=fs.readFileSync(path,'utf8');
  let changed=false;
  for(const patch of patches){
    if(patch.present&&text.includes(patch.present))continue;
    if(!text.includes(patch.from))throw Error(`${path}: patch anchor not found for ${patch.name}`);
    text=text.replace(patch.from,patch.to);
    changed=true;
  }
  if(changed)fs.writeFileSync(path,text);
  return changed;
}

const routeChanged=patchFile('app/api/reference-enrich-marketplaces/route.js',[
  {
    name:'review-target-aware-source-gate',
    present:'reviewTargetMet=generationReferences.length>=targetReviews',
    from:"const marketplaceIngestionHistory=[...priorIngestionHistory,currentMarketplaceIngestion].slice(-20),out={...rs,references:generationReferences,pulledReferences:interleaveReferencesBySource(pulled,{limit:MAX_EXPORT_REFS}),sourceCounts:orderedSourceCounts,aggregateOnlySources:aggregateOnly.filter(x=>!active.has(x.directSourceUrl||x.sourceUrl)),platformCounts:recomputePlatformCounts(generationReferences),totalIndividualReviews:generationReferences.length,availableForGeneration:generationReferences.length,totalPulledReviews:totalCollected,marketplaceTargetReviews:targetReviews,usableReviewSources:usableSources.length,matchedPages:orderedSourceCounts.length,verifiedSourceLinks:orderedSourceCounts.filter(x=>x.linkVerified).length,sourceReviewTextExported:true,sourceGate:{targetSourceCount,usableReviewSources:usableSources.length,status:usableSources.length>=targetSourceCount?'passed':'source_count_shortfall'},marketplaceIngestionHistory,marketplaceIngestion:{...currentMarketplaceIngestion,history:marketplaceIngestionHistory,cumulative:{targetReviews,totalCollected,remaining:cumulativeShortfall,status:totalCollected>=targetReviews?'complete':passFulfilled>0?'partial':lastStopReason?'provider_stopped':'stalled',lastStopReason}}};return Response.json({referenceSet:out},{headers:{'cache-control':'no-store'}})",
    to:"const reviewTargetMet=generationReferences.length>=targetReviews,sourceTargetMet=usableSources.length>=targetSourceCount,sourceGateStatus=reviewTargetMet||sourceTargetMet?'passed':'source_count_shortfall';\n  const marketplaceIngestionHistory=[...priorIngestionHistory,currentMarketplaceIngestion].slice(-20),out={...rs,references:generationReferences,pulledReferences:interleaveReferencesBySource(pulled,{limit:MAX_EXPORT_REFS}),sourceCounts:orderedSourceCounts,aggregateOnlySources:aggregateOnly.filter(x=>!active.has(x.directSourceUrl||x.sourceUrl)),platformCounts:recomputePlatformCounts(generationReferences),totalIndividualReviews:generationReferences.length,availableForGeneration:generationReferences.length,totalPulledReviews:totalCollected,marketplaceTargetReviews:targetReviews,usableReviewSources:usableSources.length,matchedPages:orderedSourceCounts.length,verifiedSourceLinks:orderedSourceCounts.filter(x=>x.linkVerified).length,sourceReviewTextExported:true,sourceGate:{targetSourceCount,usableReviewSources:usableSources.length,targetReviews,availableForGeneration:generationReferences.length,reviewTargetMet,sourceTargetMet,status:sourceGateStatus},marketplaceIngestionHistory,marketplaceIngestion:{...currentMarketplaceIngestion,history:marketplaceIngestionHistory,cumulative:{targetReviews,totalCollected,remaining:cumulativeShortfall,status:totalCollected>=targetReviews?'complete':passFulfilled>0?'partial':lastStopReason?'provider_stopped':'stalled',lastStopReason}}};return Response.json({referenceSet:out},{headers:{'cache-control':'no-store'}})"
  }
]);

const bridgeChanged=patchFile('app/reference-bridge.js',[
  {
    name:'target-aware-client-source-gate',
    present:'reviewTargetMet=reviewTarget>0&&available>=reviewTarget',
    from:"function assertUsableSourceGate(set,target=5){const gate=set?.sourceGate,usable=usableSourceCount(set),required=Number(gate?.targetSourceCount)||target;if(gate?.status==='source_count_shortfall'||usable<required)throw Error(`External sourcing found only ${usable}/${required} usable review sources. Blocked, aggregate-only, and zero-review pages are no longer counted. Rescan with a higher reference budget or improve source discovery before generating.`)}",
    to:"function assertUsableSourceGate(set,target=5){const gate=set?.sourceGate,usable=usableSourceCount(set),required=Number(gate?.targetSourceCount)||target,available=Number(set?.availableForGeneration??set?.references?.length??0)||0,reviewTarget=Number(gate?.targetReviews??set?.marketplaceTargetReviews??0)||0,reviewTargetMet=reviewTarget>0&&available>=reviewTarget;if(gate?.status==='passed'||reviewTargetMet)return;if(gate?.status==='source_count_shortfall'||usable<required)throw Error(`External sourcing found only ${usable}/${required} usable review sources and ${available.toLocaleString()}${reviewTarget?`/${reviewTarget.toLocaleString()}`:''} usable individual references. Blocked, aggregate-only, and zero-review pages are no longer counted. Rescan with a higher reference budget or improve source discovery before generating.`)}"
  },
  {
    name:'carry-marketplace-target-between-passes',
    present:'marketplaceTargetReviews:targetReviews,targetSourceCount:5',
    from:"async function enrichMarketplaceReferences(original,set,budget){let current=set,lastCount=exportReferences(current).length,remaining=Math.max(0,Number(budget.maxMarketplaceReviews)||0),stalled=0;for(let pass=1;remaining>0&&pass<=10;pass++){const step=Math.min(50,remaining);setInfo({status:'scanning',text:`Marketplace review pull ${pass} · collecting up to ${step} more Amazon/eBay review bodies (${lastCount}/${budget.maxMarketplaceReviews})…`});const er=await original('/api/reference-enrich-marketplaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({referenceSet:current,maxMarketplaceReviews:step,targetSourceCount:5}),cache:'no-store'}),ej=await er.json();if(!(er.ok&&ej?.referenceSet)){if(!lastCount)throw scanFailure(ej,er.status);current={...current,marketplaceIngestionError:ej?.error||`HTTP ${er.status}`};break}current=ej.referenceSet;const nextCount=exportReferences(current).length,added=nextCount-lastCount;remaining=Math.max(0,(Number(budget.maxMarketplaceReviews)||0)-nextCount);if(added<=0){stalled++;if(stalled>=1)break}else stalled=0;lastCount=nextCount}return current}",
    to:"async function enrichMarketplaceReferences(original,set,budget){let current=set,lastCount=exportReferences(current).length,remaining=Math.max(0,Number(budget.maxMarketplaceReviews)||0),stalled=0;for(let pass=1;remaining>0&&pass<=10;pass++){const step=Math.min(50,remaining),targetReviews=Number(budget.maxMarketplaceReviews)||step;setInfo({status:'scanning',text:`Marketplace review pull ${pass} · collecting up to ${step} more Amazon/eBay review bodies (${lastCount}/${targetReviews})…`});const er=await original('/api/reference-enrich-marketplaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({referenceSet:current,maxMarketplaceReviews:step,marketplaceTargetReviews:targetReviews,targetSourceCount:5}),cache:'no-store'}),ej=await er.json();if(!(er.ok&&ej?.referenceSet)){if(!lastCount)throw scanFailure(ej,er.status);current={...current,marketplaceTargetReviews:targetReviews,marketplaceIngestionError:ej?.error||`HTTP ${er.status}`};break}current={...ej.referenceSet,marketplaceTargetReviews:targetReviews};const nextCount=exportReferences(current).length,added=nextCount-lastCount;remaining=Math.max(0,targetReviews-nextCount);if(added<=0){stalled++;if(stalled>=1)break}else stalled=0;lastCount=nextCount}return current}"
  }
]);

console.log(`${routeChanged||bridgeChanged?'Applied':'Skipped'} reference target gate patch.`);

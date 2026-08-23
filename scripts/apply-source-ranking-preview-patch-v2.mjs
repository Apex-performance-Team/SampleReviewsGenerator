import{readFileSync,writeFileSync}from'node:fs';

function patch(file,fn){
  const before=readFileSync(file,'utf8');
  const after=fn(before);
  if(after!==before)writeFileSync(file,after);
  console.log(`${after===before?'unchanged':'patched'} ${file}`);
}

function replaceOnce(s,file,from,to){
  if(s.includes(to))return s;
  if(!s.includes(from))throw Error(`Patch anchor not found in ${file}: ${from.slice(0,120)}`);
  return s.replace(from,to);
}

function requireMarker(s,file,marker){
  if(!s.includes(marker))throw Error(`Post-patch marker missing in ${file}: ${marker}`);
}

const sourceHelpers=`
export function sourceReviewVolume(row){
  const values=[row?.individualExtractedCount,row?.extractedReviewCount,row?.reviewCount,row?.publicReviewCount,row?.reviewCountEstimate,row?.ratingCount,row?.ratingCountEstimate,row?.itemFeedbackCount,row?.aggregateRatingCount].map(Number).filter(x=>Number.isFinite(x)&&x>0);
  return values.length?Math.max(...values):0;
}

export function isBlockedSource(row){
  const raw=[row?.status,row?.error,row?.title,row?.sourceUrl,row?.directSourceUrl].map(x=>String(x||'')).join(' ').toLowerCase();
  return /blocked|challenged|captcha|robot or human|verify you are human|access denied|forbidden|\\/blocked(?:[/?#]|$)|blocked\\?url=/.test(raw);
}

export function isUsableReviewSource(row){
  const exact=Math.max(0,Number(row?.individualExtractedCount)||0,Number(row?.extractedReviewCount)||0,Number(row?.reviewCount)||0);
  const bodyCount=Array.isArray(row?.reviews)?row.reviews.filter(x=>String(x?.body||'').trim().length>=10).length:0;
  return !isBlockedSource(row)&&!row?.aggregateOnly&&(exact>0||bodyCount>0);
}

export function sortBestReviewSources(rows){
  return[...(rows||[])].sort((a,b)=>{
    const au=isUsableReviewSource(a),bu=isUsableReviewSource(b);
    if(au!==bu)return bu-au;
    const av=sourceReviewVolume(a),bv=sourceReviewVolume(b);
    if(av!==bv)return bv-av;
    const ah=a?.discoveryOrigin==='amazon_high_volume'||a?.provider==='bright_data_amazon_search'?1:0,bh=b?.discoveryOrigin==='amazon_high_volume'||b?.provider==='bright_data_amazon_search'?1:0;
    if(ah!==bh)return bh-ah;
    const ac=Number(a?.matchConfidence??a?.sameProductConfidence)||0,bc=Number(b?.matchConfidence??b?.sameProductConfidence)||0;
    if(ac!==bc)return bc-ac;
    return String(candidateHost(a)).localeCompare(String(candidateHost(b)));
  });
}
`;

patch('lib/reference-pipeline.mjs',s=>{
  if(!s.includes('export function sourceReviewVolume'))s=replaceOnce(s,'lib/reference-pipeline.mjs','\nexport function selectDiverseCandidates',`${sourceHelpers}\nexport function selectDiverseCandidates`);
  requireMarker(s,'lib/reference-pipeline.mjs','export function sortBestReviewSources');
  return s;
});

patch('app/api/reference-scan-v11/route.js',s=>{
  s=replaceOnce(s,'app/api/reference-scan-v11/route.js',
    "import{interleaveReferencesBySource,referenceBudget,selectRetailerDiverseCandidates,uniqueReferences}from'../../../lib/reference-pipeline.mjs';",
    "import{interleaveReferencesBySource,isUsableReviewSource,referenceBudget,selectRetailerDiverseCandidates,sortBestReviewSources,uniqueReferences}from'../../../lib/reference-pipeline.mjs';");
  s=replaceOnce(s,'app/api/reference-scan-v11/route.js',
    "async function html(x,t=16000){const u=url(x);if(!u)throw Error('invalid_public_url');const r=await fetch(u,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(t)}),h=await r.text();if(r.status===403||r.status===429||/captcha|robot check|verify you are human|access denied|hold button/i.test(h.slice(0,7000)))throw Error('blocked_or_challenged');if(!r.ok)throw Error(`http_${r.status}`);return{h,u:r.url}}",
    "async function html(x,t=16000){const u=url(x);if(!u)throw Error('invalid_public_url');const r=await fetch(u,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(t)}),h=await r.text(),finalUrl=String(r.url||u.href);if(r.status===403||r.status===429||/\\/blocked(?:[/?#]|$)|blocked\\?url=|captcha|robot check|robot or human|verify you are human|verify your identity|access denied|press and hold|hold button/i.test(`${finalUrl}\\n${h.slice(0,9000)}`))throw Error('blocked_or_challenged');if(!r.ok)throw Error(`http_${r.status}`);return{h,u:finalUrl}}");
  s=replaceOnce(s,'app/api/reference-scan-v11/route.js',
    "function sourceCounts(pages){return pages.map(p=>({platform:host(p.directSourceUrl),provider:isAmazonUrl(p.directSourceUrl)?'bright_data_google_lens':((p.ing?.providers||[])[0]||'bright_data_google_lens'),sourceUrl:p.directSourceUrl,directSourceUrl:p.directSourceUrl,asin:p.asin||amazonAsin(p.directSourceUrl)||null,title:p.title||null,status:p.status,matchConfidence:Number((p.matchScore||p.score||0).toFixed(3)),confidence:p.confidence,publicReviewCount:p.publicCount??null,countKind:p.publicCount!=null?(p.status==='found'?'page_or_lens':'lens_or_web'):null,extractedReviewCount:p.reviewCount||0,individualExtractedCount:p.reviewCount||0,pageCount:1,aggregateOnly:Boolean(p.aggregateOnly),ratingEstimate:p.rating??null,error:p.error||null,linkVerified:true,linkVerification:p.method,lensTabs:p.tabs,lensRank:p.rank,verificationMethod:p.method,verificationReason:p.aiReason||null})).sort((a,b)=>((b.individualExtractedCount||0)-(a.individualExtractedCount||0))||((b.matchConfidence||0)-(a.matchConfidence||0))||String(a.platform).localeCompare(String(b.platform)))}",
    "function sourceCounts(pages){return sortBestReviewSources(pages.map(p=>({platform:host(p.directSourceUrl),provider:isAmazonUrl(p.directSourceUrl)?'bright_data_google_lens':((p.ing?.providers||[])[0]||'bright_data_google_lens'),sourceUrl:p.directSourceUrl,directSourceUrl:p.directSourceUrl,asin:p.asin||amazonAsin(p.directSourceUrl)||null,title:p.title||null,status:p.status,matchConfidence:Number((p.matchScore||p.score||0).toFixed(3)),confidence:p.confidence,publicReviewCount:p.publicCount??null,countKind:p.publicCount!=null?(p.status==='found'?'page_or_lens':'lens_or_web'):null,extractedReviewCount:p.reviewCount||0,individualExtractedCount:p.reviewCount||0,pageCount:1,aggregateOnly:Boolean(p.aggregateOnly),ratingEstimate:p.rating??null,error:p.error||null,linkVerified:true,linkVerification:p.method,lensTabs:p.tabs,lensRank:p.rank,verificationMethod:p.method,verificationReason:p.aiReason||null})))}");
  s=replaceOnce(s,'app/api/reference-scan-v11/route.js',
    "const verified=await verifyWithLocal(req,productTitle,productDescription,srcImages,candidates),acceptedAll=verified.filter(x=>x.accepted),accepted=selectRetailerDiverseCandidates(acceptedAll,{limit:targetSourceCount,maxPerHost:4,maxPerFamily:4}),candidateDiagnostics=verified.slice(0,12).map(candidateDiagnostic),rejectedCandidateDiagnostics=verified.filter(x=>!x.accepted).slice(0,12).map(candidateDiagnostic);",
    "const verified=await verifyWithLocal(req,productTitle,productDescription,srcImages,candidates),acceptedAll=verified.filter(x=>x.accepted),ingestSourceLimit=Math.max(targetSourceCount,Math.min(budget.maxSources,acceptedAll.length)),accepted=selectRetailerDiverseCandidates(acceptedAll,{limit:ingestSourceLimit,maxPerHost:4,maxPerFamily:4}),candidateDiagnostics=verified.slice(0,12).map(candidateDiagnostic),rejectedCandidateDiagnostics=verified.filter(x=>!x.accepted).slice(0,12).map(candidateDiagnostic);");
  s=s.replace("sources=sourceCounts(pages),aggregate=","sources=sourceCounts(pages),usableSources=sources.filter(isUsableReviewSource),aggregate=");
  s=s.replace("amazonResolutionStrategy:'lens_discovery_then_bounded_marketplace_enrichment'","amazonResolutionStrategy:'lens_identity_then_high_volume_marketplace_enrichment'");
  s=s.replace("availableForGeneration:generationReferences.length,platformCounts","availableForGeneration:generationReferences.length,usableReviewSources:usableSources.length,platformCounts");
  s=s.replace("verifiedSourceLinks:sources.length,lensDiscovery","verifiedSourceLinks:sources.length,sourceGate:{targetSourceCount,usableReviewSources:usableSources.length,status:usableSources.length>=targetSourceCount?'passed':'source_count_shortfall'},lensDiscovery");
  s=s.replace("acceptedCandidates:accepted.length,rejectedCandidates","acceptedCandidates:accepted.length,selectedForIngestion:accepted.length,rejectedCandidates");
  s=s.replace("'diverse_verified_source_selection','verified_listing_review_ingestion'","'oversampled_verified_source_ingestion'");
  s=s.replace("'review_count_enrichment','reference_corpus'","'review_count_enrichment','high_volume_marketplace_enrichment','reference_corpus'");
  s=s.replace("reviewSources:sources.length,generatedAt","reviewSources:sources.length,usableReviewSources:usableSources.length,generatedAt");
  requireMarker(s,'app/api/reference-scan-v11/route.js',"sourceGate:{targetSourceCount");
  return s;
});

patch('app/api/reference-enrich-marketplaces/route.js',s=>{
  s=replaceOnce(s,'app/api/reference-enrich-marketplaces/route.js',
    "import{interleaveReferencesBySource}from'../../../lib/reference-pipeline.mjs';",
    "import{interleaveReferencesBySource,isUsableReviewSource,sortBestReviewSources,sourceReviewVolume}from'../../../lib/reference-pipeline.mjs';");
  if(!s.includes('function hasManualAmazon(rs)'))s=replaceOnce(s,'app/api/reference-enrich-marketplaces/route.js',
    "function noCreditResult(x){",
    "function hasManualAmazon(rs){return marketplaceSources(rs).some(x=>isAmazonV2(x.directSourceUrl||x.sourceUrl)&&x.discoveryOrigin==='manual_verified_amazon')}\nfunction hasHighVolumeAmazon(rs){return marketplaceSources(rs).some(x=>isAmazonV2(x.directSourceUrl||x.sourceUrl)&&(x.discoveryOrigin==='amazon_high_volume'||x.provider==='bright_data_amazon_search'))}\nfunction noCreditResult(x){");
  s=replaceOnce(s,'app/api/reference-enrich-marketplaces/route.js',
    "function rankSources(rows){return[...rows].sort((a,b)=>{const ah=a.discoveryOrigin==='amazon_high_volume'?1:0,bh=b.discoveryOrigin==='amazon_high_volume'?1:0;if(ah!==bh)return bh-ah;const ac=Number(a.matchConfidence||a.sameProductConfidence||0),bc=Number(b.matchConfidence||b.sameProductConfidence||0);if(ac!==bc)return bc-ac;return(Number(b.publicReviewCount||b.reviewCountEstimate)||0)-(Number(a.publicReviewCount||a.reviewCountEstimate)||0)})}",
    "function rankSources(rows){return[...rows].sort((a,b)=>{const av=sourceReviewVolume(a),bv=sourceReviewVolume(b);if(av!==bv)return bv-av;const ah=a.discoveryOrigin==='amazon_high_volume'||a.provider==='bright_data_amazon_search'?1:0,bh=b.discoveryOrigin==='amazon_high_volume'||b.provider==='bright_data_amazon_search'?1:0;if(ah!==bh)return bh-ah;const ac=Number(a.matchConfidence||a.sameProductConfidence||0),bc=Number(b.matchConfidence||b.sameProductConfidence||0);if(ac!==bc)return bc-ac;return String(host(a.directSourceUrl||a.sourceUrl)).localeCompare(String(host(b.directSourceUrl||b.sourceUrl)))})}");
  s=replaceOnce(s,'app/api/reference-enrich-marketplaces/route.js',
    "function allocateAmazonBudgets(sources,totalBudget){const rows=rankSources(sources),n=rows.length;if(!n||totalBudget<=0)return[];const budget=Math.max(0,Math.min(MAX_MARKETPLACE_PULLS,Math.floor(totalBudget))),floor=Math.min(MIN_AMAZON_PER_SOURCE,Math.max(1,Math.floor(budget/n)));let left=Math.max(0,budget-floor*n);const weights=rows.map(s=>Math.max(1,Math.sqrt(Math.max(0,Number(s.publicReviewCount||s.reviewCountEstimate)||0)+1))),weightTotal=weights.reduce((a,b)=>a+b,0)||1;const out=rows.map((src,i)=>{const extra=Math.floor(left*weights[i]/weightTotal);return{src,budget:floor+extra}});let assigned=out.reduce((a,x)=>a+x.budget,0),cursor=0;while(assigned<budget&&out.length){out[cursor%out.length].budget++;assigned++;cursor++}return out.filter(x=>x.budget>0)}",
    "function allocateAmazonBudgets(sources,totalBudget){const rows=rankSources(sources),n=rows.length;if(!n||totalBudget<=0)return[];const budget=Math.max(0,Math.min(MAX_MARKETPLACE_PULLS,Math.floor(totalBudget))),floor=Math.min(MIN_AMAZON_PER_SOURCE,Math.max(1,Math.floor(budget/n)));let left=Math.max(0,budget-floor*n);const weights=rows.map(s=>Math.max(1,Math.sqrt(sourceReviewVolume(s)+1))),weightTotal=weights.reduce((a,b)=>a+b,0)||1;const out=rows.map((src,i)=>{const extra=Math.floor(left*weights[i]/weightTotal);return{src,budget:floor+extra}});let assigned=out.reduce((a,x)=>a+x.budget,0),cursor=0;while(assigned<budget&&out.length){out[cursor%out.length].budget++;assigned++;cursor++}return out.filter(x=>x.budget>0)}");
  s=replaceOnce(s,'app/api/reference-enrich-marketplaces/route.js',
    "if(hasVerifiedAmazon(rs))discovery={candidates:[],queries:[],diagnostics:{skipped:true,reason:'verified_amazon_source_already_present'}};",
    "if(hasManualAmazon(rs))discovery={candidates:[],queries:[],diagnostics:{skipped:true,reason:'manual_amazon_listing_supplied'}};\n  else if(hasHighVolumeAmazon(rs))discovery={candidates:[],queries:[],diagnostics:{skipped:true,reason:'high_volume_amazon_source_already_present'}};");
  s=s.replace("row.status=pulledFromSource?'found':(row.status||'found');if(result.aggregateRatingCount!=null)",
    "row.status=pulledFromSource?'found':(row.status||'found');if(result.itemFeedbackCount!=null){row.itemFeedbackCount=result.itemFeedbackCount;if(row.publicReviewCount==null)row.publicReviewCount=result.itemFeedbackCount}if(result.aggregateRatingCount!=null)");
  s=s.replace("const generationReferences=interleaveReferencesBySource(generation,{limit:MAX_GENERATION_REFS}),active=new Set(generationReferences.map(r=>r.sourceUrl)),out={",
    "const orderedSourceCounts=sortBestReviewSources(sourceCounts),generationReferences=interleaveReferencesBySource(generation,{limit:MAX_GENERATION_REFS}),active=new Set(generationReferences.map(r=>r.sourceUrl)),usableSources=orderedSourceCounts.filter(isUsableReviewSource),targetSourceCount=Number(body?.targetSourceCount||rs?.targetSourceCount)||5,out={");
  s=s.replace("out={...rs,references:generationReferences,pulledReferences:interleaveReferencesBySource(pulled,{limit:MAX_EXPORT_REFS}),sourceCounts,aggregateOnlySources:",
    "out={...rs,references:generationReferences,pulledReferences:interleaveReferencesBySource(pulled,{limit:MAX_EXPORT_REFS}),sourceCounts:orderedSourceCounts,aggregateOnlySources:");
  s=s.replace("totalPulledReviews:Math.min(MAX_EXPORT_REFS,pulled.length),matchedPages:sourceCounts.length,verifiedSourceLinks:sourceCounts.filter",
    "totalPulledReviews:Math.min(MAX_EXPORT_REFS,pulled.length),usableReviewSources:usableSources.length,matchedPages:orderedSourceCounts.length,verifiedSourceLinks:orderedSourceCounts.filter");
  s=s.replace("verifiedSourceLinks:orderedSourceCounts.filter(x=>x.linkVerified).length,sourceReviewTextExported:true,marketplaceIngestion",
    "verifiedSourceLinks:orderedSourceCounts.filter(x=>x.linkVerified).length,sourceReviewTextExported:true,sourceGate:{targetSourceCount,usableReviewSources:usableSources.length,status:usableSources.length>=targetSourceCount?'passed':'source_count_shortfall'},marketplaceIngestion");
  s=s.replace("budget:x.budget})),ebaySources","budget:x.budget,publicReviewCount:sourceReviewVolume(x.src)||null})),ebaySources");
  s=s.replace("budget:x.budget}))}}};return Response.json","budget:x.budget,publicReviewCount:sourceReviewVolume(x.src)||null}))}}};return Response.json");
  requireMarker(s,'app/api/reference-enrich-marketplaces/route.js','manual_amazon_listing_supplied');
  requireMarker(s,'app/api/reference-enrich-marketplaces/route.js','sourceGate:{targetSourceCount');
  return s;
});

const bridgeHelpers=`function usableSourceCount(set){if(Number.isFinite(Number(set?.usableReviewSources)))return Number(set.usableReviewSources);return(Array.isArray(set?.sourceCounts)?set.sourceCounts:[]).filter(x=>{const raw=\`\${x?.status||''} \${x?.error||''} \${x?.title||''} \${x?.sourceUrl||''} \${x?.directSourceUrl||''}\`.toLowerCase(),exact=Number(x?.individualExtractedCount??x?.extractedReviewCount??x?.reviewCount)||0;return!x?.aggregateOnly&&exact>0&&!/blocked|challenged|captcha|robot or human|verify you are human|access denied|forbidden|\\/blocked(?:[/?#]|$)|blocked\\?url=/.test(raw)}).length}
function assertUsableSourceGate(set,target=5){const gate=set?.sourceGate,usable=usableSourceCount(set),required=Number(gate?.targetSourceCount)||target;if(gate?.status==='source_count_shortfall'||usable<required)throw Error(\`External sourcing found only \${usable}/\${required} usable review sources. Blocked, aggregate-only, and zero-review pages are no longer counted. Rescan with a higher reference budget or improve source discovery before generating.\`)}
`;

patch('app/reference-bridge.js',s=>{
  if(!s.includes('function usableSourceCount(set)'))s=replaceOnce(s,'app/reference-bridge.js','function csvCell(v){',`${bridgeHelpers}function csvCell(v){`);
  s=s.replace("body:JSON.stringify({referenceSet:set,maxMarketplaceReviews:budget.maxMarketplaceReviews}),cache:'no-store'})",
    "body:JSON.stringify({referenceSet:set,maxMarketplaceReviews:budget.maxMarketplaceReviews,targetSourceCount:5}),cache:'no-store'})");
  s=replaceOnce(s,'app/reference-bridge.js',
    "async function ensureReferences(p){if(!enabledRef.current)return null;if(!healthReadyRef.current){for(let i=0;i<50&&!healthReadyRef.current;i++)await new Promise(r=>setTimeout(r,100));}if(!configuredRef.current)throw Error('External reference sourcing is enabled, but AI Gateway reference search is unavailable. Turn references Off to generate PDP-only fixtures.');const row=productsRef.current.get(p.productUrl)||{productUrl:p.productUrl,productTitle:p.productTitle,productDescription:p.productDescription||'',existingReviewCount:null};if(!productsRef.current.has(row.productUrl))productsRef.current.set(row.productUrl,row);const cached=cacheRef.current.get(row.productUrl);if(cached)return cached;setInfo({status:'scanning',text:`Waiting for external review sourcing to finish before generating ${row.productTitle||'this product'}…`});const res=await queueReferenceScan(row);if(!res.ok)throw Error(`External reference sourcing failed for ${row.productTitle||'this product'}: ${res.error}`);return res.set}",
    "async function ensureReferences(p){if(!enabledRef.current)return null;if(!healthReadyRef.current){for(let i=0;i<50&&!healthReadyRef.current;i++)await new Promise(r=>setTimeout(r,100));}if(!configuredRef.current)throw Error('External reference sourcing is enabled, but AI Gateway reference search is unavailable. Turn references Off to generate PDP-only fixtures.');const row=productsRef.current.get(p.productUrl)||{productUrl:p.productUrl,productTitle:p.productTitle,productDescription:p.productDescription||'',existingReviewCount:null};if(!productsRef.current.has(row.productUrl))productsRef.current.set(row.productUrl,row);const cached=cacheRef.current.get(row.productUrl);if(cached){assertUsableSourceGate(cached);return cached}setInfo({status:'scanning',text:`Waiting for external review sourcing to finish before generating ${row.productTitle||'this product'}…`});const res=await queueReferenceScan(row);if(!res.ok)throw Error(`External reference sourcing failed for ${row.productTitle||'this product'}: ${res.error}`);assertUsableSourceGate(res.set);return res.set}");
  requireMarker(s,'app/reference-bridge.js','assertUsableSourceGate');
  return s;
});

const BUDGETS={
  test:{id:'test',label:'Test',maxImages:3,maxCandidates:24,maxSources:20,maxPages:3,maxEndpoints:6,maxMarketplaceReviews:20,maxAmazonQueries:4,maxAmazonPages:2,maxReferenceAiCalls:7,useAiCountEnrichment:true,useAiAmazonQueries:true,useAiAmazonWebFallback:false},
  balanced:{id:'balanced',label:'Balanced',maxImages:3,maxCandidates:30,maxSources:20,maxPages:5,maxEndpoints:10,maxMarketplaceReviews:50,maxAmazonQueries:4,maxAmazonPages:2,maxReferenceAiCalls:8,useAiCountEnrichment:true,useAiAmazonQueries:true,useAiAmazonWebFallback:true},
  thorough:{id:'thorough',label:'Thorough',maxImages:4,maxCandidates:36,maxSources:24,maxPages:8,maxEndpoints:16,maxMarketplaceReviews:50,maxAmazonQueries:4,maxAmazonPages:2,maxReferenceAiCalls:10,useAiCountEnrichment:true,useAiAmazonQueries:true,useAiAmazonWebFallback:true}
};

export function referenceBudget(value){
  const id=String(value||'test').trim().toLowerCase();
  return{...(BUDGETS[id]||BUDGETS.test)};
}

export function referenceBudgets(){return Object.values(BUDGETS).map(x=>({...x}))}

export function candidateHost(value){
  const raw=typeof value==='string'?value:value?.u||value?.directSourceUrl||value?.sourceUrl||'';
  try{return new URL(raw).hostname.replace(/^www\./,'').toLowerCase()}catch{return'unknown'}
}

export function candidateFamily(value){
  const h=candidateHost(value);
  if(/(^|\.)amazon\./i.test(h))return'amazon';
  if(/(^|\.)ebay\./i.test(h))return'ebay';
  if(/(^|\.)walmart\./i.test(h))return'walmart';
  if(/(^|\.)aliexpress\./i.test(h))return'aliexpress';
  if(/(^|\.)temu\./i.test(h))return'temu';
  if(/(^|\.)etsy\./i.test(h))return'etsy';
  return h;
}

function candidateScore(x){
  const score=Number(x?.matchScore??x?.score)||0,images=Number(x?.imageHits)||0,rank=Number(x?.rank),volume=Math.max(0,Number(x?.publicCount??x?.publicReviewCount??x?.reviewCountEstimate)||0);
  return score*1000+Math.log10(volume+1)*10+Math.min(4,images)*2-(Number.isFinite(rank)?Math.min(100,rank)/100:1);
}

export function sourceReviewVolume(row){
  const values=[row?.individualExtractedCount,row?.extractedReviewCount,row?.reviewCount,row?.publicReviewCount,row?.reviewCountEstimate,row?.ratingCount,row?.ratingCountEstimate,row?.itemFeedbackCount,row?.aggregateRatingCount].map(Number).filter(x=>Number.isFinite(x)&&x>0);
  return values.length?Math.max(...values):0;
}

export function isBlockedSource(row){
  const raw=[row?.status,row?.error,row?.title,row?.sourceUrl,row?.directSourceUrl].map(x=>String(x||'')).join(' ').toLowerCase();
  return /blocked|challenged|captcha|robot or human|verify you are human|access denied|forbidden|\/blocked(?:[/?#]|$)|blocked\?url=/.test(raw);
}

export function isUsableReviewSource(row){
  const exact=Math.max(0,Number(row?.individualExtractedCount)||0,Number(row?.extractedReviewCount)||0,Number(row?.reviewCount)||0);
  const bodyCount=Array.isArray(row?.reviews)?row.reviews.filter(x=>String(x?.body||'').trim().length>=10).length:0;
  const hasReviews=exact>0||bodyCount>0;
  return !row?.aggregateOnly&&hasReviews&&!(isBlockedSource(row)&&!hasReviews);
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

export function selectDiverseCandidates(rows,{limit=24,maxPerHost=4}={}){
  const groups=new Map();
  for(const row of rows||[]){
    const h=candidateHost(row),group=groups.get(h)||[];
    group.push(row);groups.set(h,group);
  }
  for(const group of groups.values())group.sort((a,b)=>candidateScore(b)-candidateScore(a));
  const ordered=[...groups.entries()].sort((a,b)=>candidateScore(b[1][0])-candidateScore(a[1][0]));
  const out=[];
  for(let round=0;out.length<limit&&round<maxPerHost;round++){
    for(const[,group]of ordered){if(group[round])out.push(group[round]);if(out.length>=limit)break}
  }
  return out;
}

export function selectRetailerDiverseCandidates(rows,{limit=24,maxPerHost=4,maxPerFamily=4}={}){
  const hostDiverse=selectDiverseCandidates(rows,{limit:(rows||[]).length,maxPerHost}),groups=new Map();
  for(const row of hostDiverse){const family=candidateFamily(row),group=groups.get(family)||[];group.push(row);groups.set(family,group)}
  const ordered=[...groups.entries()].sort((a,b)=>candidateScore(b[1][0])-candidateScore(a[1][0])),out=[];
  for(let round=0;out.length<limit&&round<maxPerFamily;round++)for(const[,group]of ordered){if(group[round])out.push(group[round]);if(out.length>=limit)break}
  return out;
}

export function interleaveReferencesBySource(rows,{limit=1200}={}){
  const groups=new Map();
  for(const row of rows||[]){const key=`${candidateFamily(row?.sourceUrl||row?.platform)}|${row?.sourceUrl||''}`,group=groups.get(key)||[];group.push(row);groups.set(key,group)}
  const out=[],ordered=[...groups.values()];
  for(let round=0;out.length<limit;round++){let added=false;for(const group of ordered)if(group[round]){out.push(group[round]);added=true;if(out.length>=limit)break}if(!added)break}
  return out;
}

export function normalizedReviewBody(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}

export function uniqueReferences(rows,{limit=1200}={}){
  const out=[],seen=new Set();
  for(const row of rows||[]){const key=normalizedReviewBody(row?.sourceBody);if(!key||seen.has(key))continue;seen.add(key);out.push(row);if(out.length>=limit)break}
  return out;
}

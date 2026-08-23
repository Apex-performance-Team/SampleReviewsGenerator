const BUDGETS={
  test:{id:'test',label:'Test',maxImages:1,maxCandidates:6,maxSources:6,maxPages:3,maxEndpoints:6,maxMarketplaceReviews:20,maxAmazonQueries:1,maxAmazonPages:1,maxReferenceAiCalls:2,useAiCountEnrichment:false,useAiAmazonQueries:false,useAiAmazonWebFallback:false},
  balanced:{id:'balanced',label:'Balanced',maxImages:2,maxCandidates:24,maxSources:16,maxPages:5,maxEndpoints:10,maxMarketplaceReviews:50,maxAmazonQueries:3,maxAmazonPages:2,maxReferenceAiCalls:8,useAiCountEnrichment:true,useAiAmazonQueries:true,useAiAmazonWebFallback:true},
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

function candidateScore(x){
  const score=Number(x?.matchScore??x?.score)||0,images=Number(x?.imageHits)||0,rank=Number(x?.rank);
  return score*100+Math.min(4,images)*2-(Number.isFinite(rank)?Math.min(100,rank)/100:1);
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

export function normalizedReviewBody(value){return String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}

export function uniqueReferences(rows,{limit=1200}={}){
  const out=[],seen=new Set();
  for(const row of rows||[]){const key=normalizedReviewBody(row?.sourceBody);if(!key||seen.has(key))continue;seen.add(key);out.push(row);if(out.length>=limit)break}
  return out;
}

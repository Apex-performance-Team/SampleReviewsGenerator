// Only material defects can authorize a paid rewrite. Broad diversity signals
// remain diagnostic; they are not evidence that a review needs changing.
export const PDP_QUALITY_POLICY='material-defects-v1';
export const MATERIAL_ISSUE_TYPES=['repetitive','off_product','contradicted_fact','unsupported_fact','incoherent'];
const normalize=value=>String(value||'').toLowerCase().replace(/\s+/g,' ').trim();
const quoteIn=(quote,text)=>normalize(quote).length>=12&&normalize(text).includes(normalize(quote));

export function materialIssues(values,reviews,productContext=''){
  const byId=new Map(reviews.map(review=>[String(review.id),review])),out=[];
  for(const value of Array.isArray(values)?values:[]){
    const id=String(value?.id||''),kind=String(value?.kind||''),review=byId.get(id);
    if(!review||!MATERIAL_ISSUE_TYPES.includes(kind)||value.severity!=='high'||Number(value.confidence)<.9||!Number.isFinite(Number(value.confidence))||String(value.reason||'').trim().length<20)continue;
    const evidence=(Array.isArray(value.evidence)?value.evidence:[]).filter(item=>byId.has(String(item?.id))&&quoteIn(item?.quote,`${byId.get(String(item.id)).title} ${byId.get(String(item.id)).body}`)).map(item=>({id:String(item.id),quote:String(item.quote).slice(0,500)}));
    if(!evidence.some(item=>item.id===id))continue;
    const relatedIds=[...new Set((Array.isArray(value.relatedIds)?value.relatedIds:[]).map(String))].filter(other=>other!==id&&byId.has(other)&&evidence.some(item=>item.id===other));
    if(kind==='repetitive'&&!relatedIds.length)continue;
    if(kind==='contradicted_fact'&&!quoteIn(value.productEvidence,productContext))continue;
    out.push({id,kind,severity:'high',confidence:Math.min(1,Number(value.confidence)),reason:String(value.reason).slice(0,500),evidence,relatedIds,productEvidence:String(value.productEvidence||'').slice(0,500)});
  }
  return out;
}

export function materialRepairIds(diagnostics,reviews,{eligibleIds}={}){
  const valid=new Set(reviews.map(review=>String(review.id))),eligible=new Set(eligibleIds||valid),ids=new Set(),parents=new Map();
  const root=id=>{if(!parents.has(id))parents.set(id,id);if(parents.get(id)!==id)parents.set(id,root(parents.get(id)));return parents.get(id)};
  const join=values=>{const group=values.map(String).filter(id=>valid.has(id));for(const id of group.slice(1))parents.set(root(id),root(group[0]))};
  for(const group of [...(diagnostics?.exactDuplicateGroups||[]),...(diagnostics?.materialDuplicateGroups||[])])join(Array.isArray(group)?group:group.ids||[]);
  // Low lexical overlap, matching titles and stock openings are normal. Only
  // near-verbatim bodies qualify without an evidence-backed model finding.
  for(const pair of diagnostics?.lexicalNearDuplicatePairs||[])if(Number(pair.score)>=.8)join(pair.ids||[]);
  for(const issue of diagnostics?.materialIssues||[]){
    if(issue.kind==='repetitive')join([issue.id,...issue.relatedIds]);
    else if(valid.has(issue.id)&&eligible.has(issue.id))ids.add(issue.id);
  }
  const groups=new Map();for(const id of parents.keys()){const key=root(id),group=groups.get(key)||[];group.push(id);groups.set(key,group)}
  for(const group of groups.values()){
    // Stable keeper across shuffled QA chunks; during verification keep the
    // untouched context and fix a replacement, rather than rewriting both.
    const sorted=group.sort(),keeper=sorted.find(id=>!eligible.has(id))||sorted.find(id=>!ids.has(id))||sorted[0];
    for(const id of sorted)if(id!==keeper&&eligible.has(id))ids.add(id);
  }
  return [...ids].sort();
}

export function qualityReview(review){
  return{id:review.id,rating:review.rating,title:review.title,body:review.body,blueprint:review.blueprint||null,personaProfile:review.personaProfile||null};
}

export function qualityState(previous){
  if(previous?.policyVersion===PDP_QUALITY_POLICY)return previous;
  return{phase:'assess',repairRounds:0,policyVersion:PDP_QUALITY_POLICY,previousPolicyRepairRounds:Number(previous?.repairRounds)||0};
}

export const MATERIAL_ASSESSMENT_RULES=`Flag ONLY high-confidence, serious defects:
- repetitive: near-verbatim text or substantially the SAME specific story/opinion copied into another review. Quote both reviews. Shared features, sentiment, use cases, ordinary experiences or generic short titles are NOT duplicates by themselves.
- off_product: clearly describes a different product/category. A different plausible use of THIS product, or deviation from a planned theme, is NOT off-product.
- contradicted_fact: a material claim contradicts an explicit PDP fact. Quote the exact conflicting PDP passage in productEvidence.
- unsupported_fact: an invented hard specification, compatibility, guarantee, safety or medical claim. Ordinary personal experiences and variable results do NOT need to appear in the PDP.
- incoherent: nonsensical or unusable text, not minor grammar, informal language or an unusual opinion.
Do NOT flag topic frequency, repeated sentence structure, common openings, shared product vocabulary, ordinary praise/complaints, or lack of stylistic variety. These reviews describe the SAME product. This may be a small, intentionally theme-grouped sample; its topic percentages say nothing about the whole dataset.
Every issue requires severity high, confidence at least 0.9, a concrete reason, and verbatim evidence from the affected review. For repetitive issues also supply relatedIds and evidence from each counterpart. Choose only the later copy; keep a stable original. If uncertain, leave the review alone. Do not fill a quota.
Return {"overallDiversityScore":100,"materialIssues":[{"id":"SYN-0002","kind":"repetitive","severity":"high","confidence":0.98,"reason":"specific material defect","relatedIds":["SYN-0001"],"evidence":[{"id":"SYN-0002","quote":"verbatim affected passage"},{"id":"SYN-0001","quote":"verbatim counterpart passage"}],"productEvidence":"only for a conflicting PDP fact"}]}. Use an empty materialIssues array when acceptable. The score is informational and never a repair threshold.`;

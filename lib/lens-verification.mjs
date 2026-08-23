const STOP=new Set('a an and are as at be been by for from has have in is it its of on or that the their this to with you your'.split(' '));
const tokens=value=>new Set(String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x=>x.length>1&&!STOP.has(x)));

export function lexicalOverlap(reference,candidate){
  const a=tokens(reference),b=tokens(candidate);if(!a.size||!b.size)return 0;
  let hit=0;for(const x of b)if(a.has(x))hit++;
  return hit/Math.max(1,b.size);
}

export function assessLocalLensCandidate(candidate,similarity,referenceText){
  const tabs=Array.isArray(candidate?.tabs)?candidate.tabs:[],exact=tabs.includes('exact_matches'),product=tabs.includes('products'),visualOnly=tabs.includes('visual_matches')&&!exact&&!product,lex=lexicalOverlap(referenceText,candidate?.title||''),score=Number(similarity?.score),dhash=Number(similarity?.differenceHash),silhouette=Number(similarity?.silhouetteIou),ok=Boolean(similarity?.ok)&&Number.isFinite(score),reasons=[];
  if(!ok)reasons.push('local_image_unavailable');
  if(lex<.16)reasons.push('lexical_overlap_below_0.16');
  let accepted=false,method='verification_failed',confidence=0;
  if(exact){accepted=true;method=ok?'lens_exact+local_visual':'lens_exact';confidence=Math.max(.82,ok?score:0)}
  else if(product&&ok&&score>=.82&&dhash>=.78&&silhouette>=.7&&lex>=.16){accepted=true;method='lens_product+local_visual';confidence=Math.min(.94,.82+(score-.82)*1.4)}
  else if(visualOnly&&ok&&score>=.88&&dhash>=.82&&silhouette>=.76&&lex>=.22){accepted=true;method='lens_visual+local_visual';confidence=Math.min(.95,.84+(score-.88)*1.5)}
  if(!accepted){if(product&&ok&&score<.82)reasons.push('product_visual_below_0.82');if(visualOnly&&ok&&score<.88)reasons.push('visual_match_below_0.88');if(ok&&dhash<.78)reasons.push('difference_hash_below_0.78');if(ok&&silhouette<.7)reasons.push('silhouette_below_0.70')}
  const imageSummary=ok?`local image ${score.toFixed(3)}`:'local image unavailable';
  return{accepted,method,confidence:Number(confidence.toFixed(3)),lexicalOverlap:Number(lex.toFixed(3)),localVisual:ok?Number(score.toFixed(3)):null,reason:accepted?`Deterministic Lens verification passed (${method}): ${imageSummary}, lexical overlap ${(lex*100).toFixed(0)}%.`:reasons.join(', ')||'deterministic_thresholds_not_met'};
}

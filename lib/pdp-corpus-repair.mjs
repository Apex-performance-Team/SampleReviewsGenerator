import{materialRepairIds}from'./pdp-quality-policy.mjs';
export const PDP_REPAIR_BATCH_SIZE=24;
export const PDP_MAX_REPAIR_ROUNDS=3;

export function pdpRepairIds(diagnostics,reviews,options){return materialRepairIds(diagnostics,reviews,options)}

export function mergePdpRepairs(original,response,requestedIds){
  const incoming=Array.isArray(response?.reviews)?response.reviews:[],requested=new Set(requestedIds.map(String)),byId=new Map(incoming.map(review=>[String(review.id),review]));
  if(incoming.length!==original.length||byId.size!==original.length||original.some(review=>!byId.has(String(review.id))))throw Error('Corpus repair returned an incomplete review set.');
  const repairedIds=[],reviews=original.map(review=>{
    const replacement=byId.get(String(review.id)),changed=replacement.title!==review.title||replacement.body!==review.body;
    if(Number(replacement.rating)!==Number(review.rating))throw Error('Corpus repair changed an assigned rating.');
    if(!changed)return review;
    if(!requested.has(String(review.id)))throw Error('Corpus repair changed an unrequested review.');
    if(typeof replacement.title!=='string'||!replacement.title.trim()||typeof replacement.body!=='string'||replacement.body.trim().length<20)throw Error('Corpus repair returned invalid replacement text.');
    repairedIds.push(String(review.id));
    return{...review,title:replacement.title.trim(),body:replacement.body.trim(),diversityRepaired:true,diversityRepairReasons:[...new Set([...(review.diversityRepairReasons||[]),...(Array.isArray(replacement.diversityRepairReasons)?replacement.diversityRepairReasons:[]).map(reason=>String(reason).slice(0,80))])].slice(0,8)};
  });
  if(requestedIds.some(id=>!repairedIds.includes(id)))throw Error('Corpus repair returned incomplete replacements.');
  return{reviews,repairedIds,repairCount:repairedIds.length};
}

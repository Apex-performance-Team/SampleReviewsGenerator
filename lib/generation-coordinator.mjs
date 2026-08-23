export async function runPool(items,limit,fn){
  let cursor=0;
  const out=new Array(items.length),workers=Math.min(Math.max(1,Number(limit)||1),items.length);
  async function worker(){while(true){const i=cursor++;if(i>=items.length)return;out[i]=await fn(items[i],i)}}
  await Promise.all(Array.from({length:workers},worker));
  return out;
}

export async function repairGeneratedCorpus({reviews,requestRepair,maxPasses=2}){
  let current=Array.isArray(reviews)?reviews:[],qa=null,totalRepairs=0;
  for(let pass=1;pass<=Math.max(1,maxPasses);pass++){
    qa=await requestRepair(current,pass);
    current=Array.isArray(qa?.reviews)?qa.reviews:current;
    totalRepairs+=Number(qa?.repairCount)||0;
    const exact=(qa?.diagnostics?.exactDuplicateGroups||[]).length,repairs=Number(qa?.repairCount)||0;
    if(!exact||pass>=maxPasses||!repairs)break;
  }
  const exact=(qa?.diagnostics?.exactDuplicateGroups||[]).length;
  if(exact)throw Error(`Corpus QA still found ${exact} exact duplicate group${exact===1?'':'s'} after repair.`);
  return{reviews:current,diagnostics:qa?.diagnostics||null,repairCount:totalRepairs,model:qa?.model||null};
}

function normalizedBody(x){return String(x?.body||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}

export function duplicateBatchRepairs(parts){
  const seen=new Map(),repairs=new Map();
  for(const part of [...(Array.isArray(parts)?parts:[])].sort((a,b)=>(Number(a?.offset)||0)-(Number(b?.offset)||0))){
    const offset=Number(part?.offset)||0;
    for(const review of part?.reviews||[]){
      const key=normalizedBody(review);
      if(!key)continue;
      if(seen.has(key)){
        const bodies=repairs.get(offset)||[];
        bodies.push(seen.get(key),String(review.body||''));
        repairs.set(offset,bodies);
      }else seen.set(key,String(review.body||''));
    }
  }
  return[...repairs.entries()].map(([offset,bodies])=>({offset,bodies:[...new Set(bodies)]}));
}

export async function repairGeneratedCorpusSafely(options){
  const original=Array.isArray(options?.reviews)?options.reviews:[];
  try{
    const qa=await repairGeneratedCorpus(options);
    return{...qa,diagnostics:{...(qa.diagnostics||{}),qaStatus:'completed'}};
  }catch(error){
    const uniqueBodies=new Set(original.map(normalizedBody)).size;
    if(uniqueBodies!==original.length)throw error;
    const qaError=error?.message||'Corpus QA failed.';
    return{reviews:original,repairCount:0,model:null,diagnostics:{qaStatus:'unavailable',qaError,deterministicExactBodyCheck:'passed',exactDuplicateGroups:[],uniqueBodies}};
  }
}

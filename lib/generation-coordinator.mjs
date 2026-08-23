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

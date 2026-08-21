export const runtime='nodejs';
export const maxDuration=240;
export const dynamic='force-dynamic';
import{searchAmazonProducts}from'../../../lib/amazon-product-search';

const QUERIES=[
  '360 omnidirectional amplified outdoor tv antenna 100 miles',
  'outdoor tv antenna 360 omni directional reception 100 miles',
  'omnidirectional outdoor HDTV antenna amplified VHF UHF 4K'
];
export async function GET(){
  const started=Date.now();
  const settled=await Promise.all(QUERIES.map(async q=>{try{return await searchAmazonProducts(q,{pages:2})}catch(e){return{ok:false,keyword:q,error:e?.message||String(e),results:[]}}}));
  const map=new Map();
  for(const run of settled)for(const r of run.results||[]){const old=map.get(r.asin);if(!old||(r.ratingCount||0)>(old.ratingCount||0))map.set(r.asin,{...r,queries:[...(old?.queries||[]),run.keyword]})}
  const results=[...map.values()].sort((a,b)=>(b.ratingCount||0)-(a.ratingCount||0)).slice(0,40);
  return Response.json({ok:settled.some(x=>x.ok),elapsedMs:Date.now()-started,queries:settled.map(x=>({keyword:x.keyword,ok:x.ok,rawRows:x.rawRows||0,snapshotId:x.snapshotId||null,error:x.error||'',top:(x.results||[]).slice(0,8)})),results,containsTarget:results.some(x=>x.asin==='B089LMG6L4')},{headers:{'cache-control':'no-store'}})
}

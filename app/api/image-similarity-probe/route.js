export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';
import{recoverPdpIdentity}from'../../../lib/pdp-identity';
import{searchAmazonProducts}from'../../../lib/amazon-product-search';
import{rankImageSimilarity}from'../../../lib/image-similarity';

const PDP='https://instabeamtv.com/products/premium-antenna-1';
const QUERIES=['indoor hdtv antenna','digital tv antenna smart tv indoor magnetic base','indoor tv antenna long range reception magnetic base'];
export async function GET(){try{const identity=await recoverPdpIdentity(PDP),runs=await Promise.all(QUERIES.map(q=>searchAmazonProducts(q,{pages:1}).catch(e=>({ok:false,keyword:q,error:e?.message||String(e),results:[]})))),map=new Map();for(const run of runs)for(const r of run.results||[]){if(!r.image)continue;const old=map.get(r.asin);if(!old||(Number(r.rankOnPage)||999)<(Number(old.rankOnPage)||999))map.set(r.asin,{...r,query:run.keyword})}const pool=[...map.values()].sort((a,b)=>(Number(a.pageNumber)||99)-(Number(b.pageNumber)||99)||(Number(a.rankOnPage)||999)-(Number(b.rankOnPage)||999)).slice(0,24),ranked=identity.image?await rankImageSimilarity(identity.image,pool.map(x=>x.image)):[],byIndex=new Map(ranked.map(x=>[x.index,x])),rows=pool.map((x,i)=>({asin:x.asin,url:x.url,title:x.title,image:x.image,query:x.query,ratingCount:x.ratingCount,rankOnPage:x.rankOnPage,similarity:byIndex.get(i)||null})).sort((a,b)=>(b.similarity?.score||0)-(a.similarity?.score||0));return Response.json({ok:true,identity,queries:QUERIES,searchRuns:runs.map(x=>({keyword:x.keyword,ok:x.ok,rawRows:x.rawRows||0,resultCount:x.results?.length||0,error:x.error||''})),candidates:rows},{headers:{'cache-control':'no-store'}})}catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500,headers:{'cache-control':'no-store'}})}}

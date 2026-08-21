export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';
import{discoverAmazonVolumeCandidates}from'../../../lib/amazon-volume-discovery-v2';

export async function GET(req){
  const rs={
    productUrl:'https://instabeamtv.com/products/premium-antenna-1',
    productTitle:'InstaBeam Premium Indoor HDTV Antenna',
    productDescription:'Indoor and outdoor HDTV antenna for receiving over-the-air television channels with simple installation and extended reception range.',
    sourceCounts:[],aggregateOnlySources:[],references:[]
  };
  try{
    const r=await discoverAmazonVolumeCandidates(req,rs);
    return Response.json({ok:r.candidates.length>0,containsTarget:r.candidates.some(x=>x.asin==='B089LMG6L4'),candidates:r.candidates.map(x=>({asin:x.asin,url:x.url,title:x.title,ratingCount:x.ratingCount,confidence:x.verificationConfidence,relation:x.verificationRelation,reason:x.verificationReason,lexicalOverlap:x.lexicalOverlap,discoveryScore:x.discoveryScore})),queries:r.queries,diagnostics:r.diagnostics},{headers:{'cache-control':'no-store'}})
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500,headers:{'cache-control':'no-store'}})}
}

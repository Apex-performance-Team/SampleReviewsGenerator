export const runtime='nodejs';
export const maxDuration=300;
export const dynamic='force-dynamic';
import{discoverAmazonVolumeCandidates}from'../../../lib/amazon-volume-discovery-v2';
import{authMode,directOpenAIToken,hasAIProvider}from'../../../lib/gateway';

export async function GET(req){
  const rs={
    productUrl:'https://instabeamtv.com/products/premium-antenna-1',
    productTitle:'InstaBeam Premium Indoor HDTV Antenna',
    productDescription:'Use the authoritative PDP itself for identity. Find only the same physical product or an exact private-label/OEM equivalent.',
    sourceCounts:[],aggregateOnlySources:[],references:[]
  };
  const ai={configured:hasAIProvider(req),auth:authMode(req),directOpenAIConfigured:Boolean(directOpenAIToken())};
  try{
    const r=await discoverAmazonVolumeCandidates(req,rs);
    return Response.json({ok:r.candidates.length>0,ai,candidates:r.candidates.map(x=>({asin:x.asin,url:x.url,title:x.title,ratingCount:x.ratingCount,confidence:x.verificationConfidence,relation:x.verificationRelation,reason:x.verificationReason,lexicalOverlap:x.lexicalOverlap,discoveryScore:x.discoveryScore})),queries:r.queries,identity:r.identity||null,diagnostics:r.diagnostics},{headers:{'cache-control':'no-store'}})
  }catch(e){return Response.json({ok:false,ai,error:e?.message||String(e)},{status:500,headers:{'cache-control':'no-store'}})}
}

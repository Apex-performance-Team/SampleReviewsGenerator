export const runtime='nodejs';
export const maxDuration=240;
export const dynamic='force-dynamic';
import{discoverHighVolumeAmazon}from'../../../lib/amazon-high-volume-discovery';

const PDP='https://instabeamtv.com/products/premium-antenna-1';

export async function GET(req){
  try{
    const scanMod=await import('../reference-scan/route.js');
    const scanReq=new Request(new URL('/api/reference-scan',req.url),{method:'POST',headers:req.headers,body:JSON.stringify({productUrl:PDP,productTitle:'InstaBeam OmniReach Extended Range TV Antenna',productDescription:'Indoor and outdoor HDTV antenna for receiving over-the-air television channels with simple installation and extended reception range.',existingReviewCount:0,targetReferenceCount:250,originalReviewCount:0})});
    const scanRes=await scanMod.POST(scanReq),scan=await scanRes.json();
    if(!scanRes.ok||!scan.referenceSet)return Response.json({ok:false,stage:'reference_scan',error:scan.error||'referenceSet missing'},{status:500,headers:{'cache-control':'no-store'}});
    const resolved=await discoverHighVolumeAmazon(req,{referenceSet:scan.referenceSet,productTitle:'InstaBeam OmniReach Extended Range TV Antenna',productDescription:'Indoor and outdoor HDTV antenna for receiving over-the-air television channels with simple installation and extended reception range.'});
    return Response.json({ok:resolved.candidates.length>0,candidates:resolved.candidates,queries:resolved.queries,clues:resolved.clues,diagnostics:resolved.diagnostics},{headers:{'cache-control':'no-store'}})
  }catch(e){return Response.json({ok:false,error:e?.message||String(e)},{status:500,headers:{'cache-control':'no-store'}})}
}

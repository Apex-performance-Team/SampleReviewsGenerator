export const runtime='nodejs';
import{gatewayToken,authMode}from'../../../lib/gateway';
export async function GET(req){
  const lensConfigured=Boolean(process.env.BRIGHT_DATA_API_KEY);
  const verifierConfigured=Boolean(gatewayToken(req));
  return Response.json({
    ok:true,
    provider:'Bright Data Google Lens + GPT-5.6 Sol verification',
    configured:lensConfigured&&verifierConfigured,
    lensConfigured,
    verifierConfigured,
    auth:authMode(req),
    zone:process.env.BRIGHT_DATA_SERP_ZONE||'serp_api1',
    env:null
  },{headers:{'cache-control':'no-store'}})
}

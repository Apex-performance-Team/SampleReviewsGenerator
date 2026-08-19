export const runtime='nodejs';
import{gatewayToken,authMode}from'../../../lib/gateway';
export async function GET(req){
  const configured=Boolean(gatewayToken(req));
  return Response.json({
    ok:true,
    provider:'Vercel AI Gateway · GPT-5.6 Terra vision + web search',
    configured,
    auth:authMode(req),
    env:null
  },{headers:{'cache-control':'no-store'}})
}

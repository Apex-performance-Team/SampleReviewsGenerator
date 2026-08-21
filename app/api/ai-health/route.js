export const runtime='nodejs';
import{gateway,MODEL,authMode}from'../../../lib/gateway';
function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function creditError(s){return /AI Gateway 402|positive credit balance|required for all requests|add credits|top-up/i.test(String(s||''))}
function diagnostics(req){return{authMode:authMode(req),explicitGatewayKeyConfigured:Boolean(process.env.AI_GATEWAY_API_KEY),oidcHeaderPresent:Boolean(req?.headers?.get?.('x-vercel-oidc-token')),oidcEnvConfigured:Boolean(process.env.VERCEL_OIDC_TOKEN),directOpenAIConfigured:Boolean(process.env.OPENAI_API_KEY)}}
export async function GET(req){
  const diag=diagnostics(req);
  try{
    const r=await gateway(req,'Reply with exactly OK.',30000);
    return Response.json({ok:true,degraded:false,aiAvailable:true,model:MODEL,auth:diag.authMode,response:r.text.trim().slice(0,50),diagnostics:diag},{headers:{'cache-control':'no-store'}})
  }catch(e){
    const error=clean(e?.message||e);
    if(creditError(error))return Response.json({ok:true,degraded:true,aiAvailable:false,model:'Reference sourcing fallback ready',auth:`${diag.authMode} · ${diag.explicitGatewayKeyConfigured?'explicit Gateway key present':'no explicit Gateway key in this environment'}`,warning:error,error:null,diagnostics:diag},{status:200,headers:{'cache-control':'no-store'}});
    return Response.json({ok:false,degraded:true,aiAvailable:false,model:MODEL,auth:diag.authMode,error,diagnostics:diag},{status:503,headers:{'cache-control':'no-store'}})
  }
}

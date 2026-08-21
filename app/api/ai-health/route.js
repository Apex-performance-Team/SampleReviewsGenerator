export const runtime='nodejs';
import{gateway,MODEL,authMode}from'../../../lib/gateway';
function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
function creditError(s){return /AI Gateway 402|positive credit balance|required for all requests|add credits|top-up/i.test(String(s||''))}
export async function GET(req){
  try{
    const r=await gateway(req,'Reply with exactly OK.',30000);
    return Response.json({ok:true,degraded:false,aiAvailable:true,model:MODEL,auth:authMode(req),response:r.text.trim().slice(0,50)},{headers:{'cache-control':'no-store'}})
  }catch(e){
    const error=clean(e?.message||e);
    if(creditError(error))return Response.json({ok:true,degraded:true,aiAvailable:false,model:'Reference sourcing fallback ready',auth:'AI generation needs Vercel credits',warning:error,error:null},{status:200,headers:{'cache-control':'no-store'}});
    return Response.json({ok:false,degraded:true,aiAvailable:false,model:MODEL,auth:authMode(req),error},{status:503,headers:{'cache-control':'no-store'}})
  }
}

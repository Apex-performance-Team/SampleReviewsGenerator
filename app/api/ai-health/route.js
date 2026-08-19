export const runtime='nodejs';
import{gateway,MODEL,authMode}from'../../../lib/gateway';
export async function GET(req){try{const r=await gateway(req,'Reply with exactly OK.',30000);return Response.json({ok:true,model:MODEL,auth:authMode(req),response:r.text.trim().slice(0,50)})}catch(e){return Response.json({ok:false,model:MODEL,auth:authMode(req),error:e.message},{status:503})}}

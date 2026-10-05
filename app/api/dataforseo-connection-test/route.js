import {createHash,timingSafeEqual} from 'node:crypto';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
const HASH='bf9e0e740b498eb6230f789c6f13e81f2003258c44a21bd1062af0f8565d0cf7';
const EXPIRES=Date.parse('2026-10-06T03:00:00Z');
const keywords=['damascus kitchen knives','damascus bread knife','nakiri knife','titanium frying pan','titanium saucepan','titanium cutting board','rolling knife sharpener','matcha set'];
function allowed(req){return Date.now()<EXPIRES&&timingSafeEqual(createHash('sha256').update((req.headers.get('authorization')||'').replace(/^Bearer /,'')).digest(),Buffer.from(HASH,'hex'));}
function auth(){const encoded=(process.env.DATAFORSEO_AUTH||'').trim().replace(/^Basic\s+/i,'');if(encoded)return 'Basic '+encoded;const login=process.env.DATAFORSEO_LOGIN,password=process.env.DATAFORSEO_PASSWORD;if(login&&password)return 'Basic '+Buffer.from(login+':'+password).toString('base64');return null;}
export async function GET(req){if(!allowed(req))return Response.json({error:'Unauthorized or expired'},{status:401});return Response.json({configured:Boolean(auth()),keywords,location:'United States',language:'English'});}
export async function POST(req){
 if(!allowed(req))return Response.json({error:'Unauthorized or expired'},{status:401});
 const credential=auth();if(!credential)return Response.json({error:'DataForSEO credentials missing'},{status:503});
 try{
 const r=await fetch('https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',{method:'POST',headers:{authorization:credential,'content-type':'application/json'},body:JSON.stringify([{keywords,location_code:2840,language_code:'en',search_partners:false}]),cache:'no-store',signal:AbortSignal.timeout(45000)});
 const d=await r.json();
 return Response.json({http_status:r.status,status_code:d.status_code,status_message:d.status_message,cost:d.cost,tasks:(d.tasks||[]).map(t=>({status_code:t.status_code,status_message:t.status_message,cost:t.cost,result:t.result})),location:'United States',language:'English'});
 }catch{return Response.json({error:'DataForSEO request failed or timed out'},{status:502});}
}
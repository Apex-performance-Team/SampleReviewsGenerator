export const runtime='nodejs';
export const maxDuration=60;

import{createHmac,timingSafeEqual}from'node:crypto';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';
const BLOCK=/(^localhost$|\.local$|^0\.|^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^\[?::1\]?$)/i;
function pub(x,b){try{const u=new URL(String(x||''),b);return /^https?:$/.test(u.protocol)&&!BLOCK.test(u.hostname)?u:null}catch{return null}}
function secret(){return process.env.BRIGHT_DATA_API_KEY||''}
function sign(u,r=''){return createHmac('sha256',secret()).update(`${u}\n${r}`).digest('hex')}
function valid(a,b){try{const x=Buffer.from(String(a||''),'hex'),y=Buffer.from(String(b||''),'hex');return x.length===y.length&&x.length>0&&timingSafeEqual(x,y)}catch{return false}}
async function fetchImage(start,referer){let u=pub(start);if(!u)throw Error('invalid_image_url');for(let i=0;i<4;i++){
  const r=await fetch(u,{headers:{'user-agent':UA,'accept':'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.3',...(referer?{referer}: {})},redirect:'manual',signal:AbortSignal.timeout(20000)});
  if([301,302,303,307,308].includes(r.status)){const next=pub(r.headers.get('location'),u);if(!next)throw Error('unsafe_image_redirect');u=next;continue}
  if(!r.ok)throw Error(`image_http_${r.status}`);
  const ct=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();if(!ct.startsWith('image/')||ct==='image/svg+xml')throw Error('upstream_not_raster_image');
  const b=Buffer.from(await r.arrayBuffer());if(b.length<300||b.length>7*1024*1024)throw Error('image_size_out_of_range');
  return{b,ct};
}throw Error('too_many_image_redirects')}

export async function GET(req){try{
  const q=new URL(req.url).searchParams,u=q.get('u')||'',r=q.get('r')||'',s=q.get('s')||'';
  if(!secret())throw Error('relay_not_configured');if(!valid(s,sign(u,r)))throw Error('invalid_signature');
  const image=await fetchImage(u,r);
  return new Response(image.b,{status:200,headers:{'content-type':image.ct,'cache-control':'public, max-age=3600, s-maxage=3600','x-content-type-options':'nosniff'}})
}catch(e){return Response.json({error:e?.message||'image_relay_failed'},{status:400,headers:{'cache-control':'no-store'}})}}
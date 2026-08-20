export const runtime='nodejs';
export const maxDuration=60;

import{createHmac,timingSafeEqual}from'node:crypto';

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151.0.0.0 Safari/537.36';
const BLOCK=/(^localhost$|\.local$|^0\.|^10\.|^127\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\.|^\[?::1\]?$)/i;
function pub(x,b){try{const u=new URL(String(x||''),b);return /^https?:$/.test(u.protocol)&&!BLOCK.test(u.hostname)?u:null}catch{return null}}
function sec(){return process.env.BRIGHT_DATA_API_KEY||''}
function sig(x){return createHmac('sha256',sec()).update(x).digest('hex')}
function valid(a,b){try{const x=Buffer.from(String(a||''),'hex'),y=Buffer.from(String(b||''),'hex');return x.length===y.length&&x.length>0&&timingSafeEqual(x,y)}catch{return false}}
function esc(x){return String(x||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function clean(x){return String(x||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()}
function scripts(h){const out=[];for(const m of String(h||'').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){try{out.push(JSON.parse(m[1]))}catch{}}return out}
function walk(x,f,seen=new Set()){if(!x||typeof x!=='object'||seen.has(x))return;seen.add(x);f(x);for(const v of Array.isArray(x)?x:Object.values(x))walk(v,f,seen)}
function productImages(h,base){const found=[],add=x=>{if(Array.isArray(x))return x.forEach(add);if(x&&typeof x==='object')return add(x.url||x.contentUrl);const u=pub(x,base);if(!u||/(logo|icon|favicon|sprite|payment|badge)/i.test(u.href)||found.includes(u.href))return;found.push(u.href)};for(const m of String(h).matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/gi))add(m[1]);for(const j of scripts(h))walk(j,o=>{const t=o?.['@type'];if(t==='Product'||Array.isArray(t)&&t.includes('Product'))add(o.image)});for(const m of String(h).matchAll(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/gi))add(m[1]);for(const m of String(h).matchAll(/<img[^>]+(?:data-src|src)=["']([^"']+)/gi))add(m[1]);return found.slice(0,3)}

export async function GET(req){try{
  const q=new URL(req.url).searchParams,source=q.get('u')||'',s=q.get('s')||'';
  if(!sec())throw Error('staging_not_configured');if(!valid(s,sig(source)))throw Error('invalid_signature');const u=pub(source);if(!u)throw Error('invalid_product_url');
  const r=await fetch(u,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(20000)}),h=await r.text();if(!r.ok)throw Error(`pdp_http_${r.status}`);
  const imgs=productImages(h,r.url);if(!imgs.length)throw Error('no_product_images');const origin=new URL(req.url).origin;
  const relays=imgs.map(im=>{const referer=r.url,rs=createHmac('sha256',sec()).update(`${im}\n${referer}`).digest('hex');return `${origin}/api/lens-image?u=${encodeURIComponent(im)}&r=${encodeURIComponent(referer)}&s=${rs}`});
  const title=clean(h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'Product');
  const body=`<!doctype html><html><head><title>${esc(title)}</title>${relays.map(x=>`<meta property="og:image" content="${esc(x)}">`).join('')}</head><body>${relays.map(x=>`<img src="${esc(x)}" alt="${esc(title)}">`).join('')}</body></html>`;
  return new Response(body,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}})
}catch(e){return Response.json({error:e?.message||'pdp_staging_failed'},{status:400,headers:{'cache-control':'no-store'}})}}
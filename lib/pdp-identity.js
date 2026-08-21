const clean=x=>String(x??'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g,' ').trim();
function scripts(h){const out=[];for(const m of String(h||'').matchAll(/<script[^>]*(?:type=["']application\/ld\+json["'])?[^>]*>([\s\S]*?)<\/script>/gi)){const s=m[1].trim();if(!s||s.length>2000000)continue;try{out.push(JSON.parse(s))}catch{}}return out}
function walk(x,fn,seen=new Set()){if(!x||typeof x!=='object'||seen.has(x))return;seen.add(x);fn(x);for(const v of Array.isArray(x)?x:Object.values(x))walk(v,fn,seen)}
export async function recoverPdpIdentity(productUrl){
  if(!productUrl)return{title:'',description:'',image:null};
  try{
    const r=await fetch(productUrl,{headers:{'user-agent':'Mozilla/5.0','accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(15000)});if(!r.ok)return{title:'',description:'',image:null,error:`http_${r.status}`};const h=await r.text();
    let title=clean(h.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1]||h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||''),description=clean(h.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)/i)?.[1]||''),image=h.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i)?.[1]||null;
    let best=null;for(const j of scripts(h))walk(j,o=>{const t=o?.['@type'],product=t==='Product'||Array.isArray(t)&&t.includes('Product');if(product&&!best)best=o});
    if(best){title=clean(best.name)||title;description=clean(best.description)||description;const im=Array.isArray(best.image)?best.image[0]:best.image;if(typeof im==='string')image=im}
    if(image){try{image=new URL(image,r.url).href}catch{}}
    return{title:title.slice(0,500),description:description.slice(0,10000),image,finalUrl:r.url};
  }catch(e){return{title:'',description:'',image:null,error:e?.message||String(e)}}
}

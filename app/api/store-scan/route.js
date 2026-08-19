export const runtime='nodejs';
function normalize(v){v=String(v||'').trim();if(!/^https?:\/\//i.test(v))v='https://'+v;const u=new URL(v);u.hash='';u.search='';return u.origin}
async function get(url){const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 SyntheticReviewLab/1.0','accept':'application/xml,text/xml,text/html;q=.8'},redirect:'follow',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error(`Sitemap request failed (${r.status})`);return{url:r.url,text:await r.text()}}
function locs(xml){return[...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m=>m[1].replaceAll('&amp;','&').trim())}
function productUrls(list){return list.filter(x=>/\/products\//i.test(x)).map(x=>{try{const u=new URL(x);u.search='';u.hash='';return u.toString()}catch{return null}}).filter(Boolean)}
export async function POST(req){try{const{storeUrl}=await req.json();const origin=normalize(storeUrl);const root=await get(origin+'/sitemap.xml');let urls=productUrls(locs(root.text));const children=locs(root.text).filter(x=>/sitemap.*products|products.*sitemap/i.test(x));for(const s of children.slice(0,20)){try{const x=await get(s);urls.push(...productUrls(locs(x.text)))}catch{}}
  urls=[...new Set(urls)].filter(x=>{try{return new URL(x).hostname.replace(/^www\./,'')===new URL(root.url).hostname.replace(/^www\./,'')}catch{return false}});
  if(!urls.length)throw Error('No Shopify product URLs were found in the store sitemap.');
  return Response.json({storeUrl:new URL(root.url).origin,productCount:urls.length,products:urls.map((url,index)=>({index,url,handle:decodeURIComponent(new URL(url).pathname.split('/products/')[1]?.split('/')[0]||''),title:decodeURIComponent(new URL(url).pathname.split('/products/')[1]?.split('/')[0]||'Product').replace(/-/g,' ')}))});
}catch(e){return Response.json({error:e.message||'Store scan failed.'},{status:400})}}

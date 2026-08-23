import{readFileSync,writeFileSync}from'node:fs';

function patch(file,fn){
  const before=readFileSync(file,'utf8');
  const after=fn(before);
  if(after!==before)writeFileSync(file,after);
  console.log(`${after===before?'unchanged':'patched'} ${file}`);
}

function replaceOnce(s,file,from,to){
  if(s.includes(to))return s;
  if(!s.includes(from))throw Error(`Patch anchor not found in ${file}`);
  return s.replace(from,to);
}

patch('lib/reference-pipeline.mjs',s=>replaceOnce(s,'lib/reference-pipeline.mjs',
  "export function isUsableReviewSource(row){\n  const exact=Math.max(0,Number(row?.individualExtractedCount)||0,Number(row?.extractedReviewCount)||0,Number(row?.reviewCount)||0);\n  const bodyCount=Array.isArray(row?.reviews)?row.reviews.filter(x=>String(x?.body||'').trim().length>=10).length:0;\n  return !isBlockedSource(row)&&!row?.aggregateOnly&&(exact>0||bodyCount>0);\n}",
  "export function isUsableReviewSource(row){\n  const exact=Math.max(0,Number(row?.individualExtractedCount)||0,Number(row?.extractedReviewCount)||0,Number(row?.reviewCount)||0);\n  const bodyCount=Array.isArray(row?.reviews)?row.reviews.filter(x=>String(x?.body||'').trim().length>=10).length:0;\n  const hasReviews=exact>0||bodyCount>0;\n  return !row?.aggregateOnly&&hasReviews&&!(isBlockedSource(row)&&!hasReviews);\n}"));

patch('app/api/reference-scan-v11/route.js',s=>replaceOnce(s,'app/api/reference-scan-v11/route.js',
  "function images(h,b,maxImages=1){const a=[],add=x=>{if(Array.isArray(x))return x.forEach(add);if(x&&typeof x==='object')return add(x.url||x.contentUrl);const u=url(x,b);if(!u)return;if(u.protocol==='http:'&&/(^|\\.)instabeamtv\\.com$/i.test(u.hostname))u.protocol='https:';if(/(logo|icon|favicon|sprite|payment|badge)/i.test(u.href)||a.includes(u.href))return;a.push(u.href)};for(const m of String(h).matchAll(/<meta[^>]+property=[\"']og:image(?::secure_url)?[\"'][^>]+content=[\"']([^\"']+)/gi))add(m[1]);for(const j of scripts(h))walk(j,o=>{const t=o?.['@type'];if(t==='Product'||Array.isArray(t)&&t.includes('Product'))add(o.image)});for(const m of String(h).matchAll(/<meta[^>]+name=[\"']twitter:image[\"'][^>]+content=[\"']([^\"']+)/gi))add(m[1]);for(const m of String(h).matchAll(/<img[^>]+(?:data-src|src)=[\"']([^\"']+)/gi))add(m[1]);return a.slice(0,Math.max(1,maxImages))}",
  "function imageKey(href){try{const u=new URL(href);u.hash='';u.search='';u.pathname=u.pathname.replace(/_(?:\\d+x|\\d+x\\d+|x\\d+)(?=\\.[a-z0-9]+$)/i,'');return`${u.hostname}${u.pathname}`.toLowerCase()}catch{return String(href||'').toLowerCase()}}\nfunction images(h,b,maxImages=1){const a=[],seen=new Set(),add=x=>{if(Array.isArray(x))return x.forEach(add);if(x&&typeof x==='object')return add(x.url||x.contentUrl);const u=url(x,b);if(!u)return;if(u.protocol==='http:'&&/(^|\\.)instabeamtv\\.com$/i.test(u.hostname))u.protocol='https:';const k=imageKey(u.href);if(/(logo|icon|favicon|sprite|payment|badge)/i.test(u.href)||seen.has(k))return;seen.add(k);a.push(u.href)};for(const m of String(h).matchAll(/<meta[^>]+property=[\"']og:image(?::secure_url)?[\"'][^>]+content=[\"']([^\"']+)/gi))add(m[1]);for(const j of scripts(h))walk(j,o=>{const t=o?.['@type'];if(t==='Product'||Array.isArray(t)&&t.includes('Product'))add(o.image)});for(const m of String(h).matchAll(/<meta[^>]+name=[\"']twitter:image[\"'][^>]+content=[\"']([^\"']+)/gi))add(m[1]);for(const m of String(h).matchAll(/<img[^>]+(?:data-src|src)=[\"']([^\"']+)/gi))add(m[1]);return a.slice(0,Math.max(1,maxImages))}"));

patch('app/api/reference-enrich-marketplaces/route.js',s=>replaceOnce(s,'app/api/reference-enrich-marketplaces/route.js',
  "if(result.aggregateRating!=null)row.ratingEstimate=result.aggregateRating;if(result.error)row.error=result.error",
  "if(result.aggregateRating!=null)row.ratingEstimate=result.aggregateRating;if(pulledFromSource)row.error=null;else if(result.error)row.error=result.error"));

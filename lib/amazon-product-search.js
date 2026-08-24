import{classifyBrightDataFailure,brightDataError}from'./bright-data-status';

const DATASET='gd_lwdb4vjm1ehb499uxs';
const clean=x=>String(x??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function rowsFrom(data){return Array.isArray(data)?data:Array.isArray(data?.results)?data.results:Array.isArray(data?.data)?data.data:[data]}
function n(v){if(v==null||v==='')return null;if(typeof v==='object'){for(const k of['value','rating','score','amount'])if(v?.[k]!=null)return n(v[k]);return null}const x=Number(String(v).replace(/[^0-9.]/g,''));return Number.isFinite(x)?x:null}
function count(v){if(v==null)return null;if(Array.isArray(v)){for(const x of v){const z=count(x);if(z!=null)return z}return null}if(typeof v==='object'){for(const k of['value','count','total','ratings','rating_count','num_ratings','text','label'])if(v?.[k]!=null){const z=count(v[k]);if(z!=null)return z}return null}const m=String(v).toLowerCase().replace(/,/g,'').match(/([0-9]+(?:\.\d+)?)\s*([kmb])?/);if(!m)return null;let x=Number(m[1]);x*=m[2]==='k'?1e3:m[2]==='m'?1e6:m[2]==='b'?1e9:1;if(!Number.isFinite(x)||x<0||x>10000000)return null;return Math.round(x)}
function asinFrom(x){const a=clean(x?.asin||x?.ASIN||'').toUpperCase();if(/^B[A-Z0-9]{9}$/.test(a))return a;for(const v of[x?.url,x?.product_url,x?.link]){const m=String(v||'').match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);if(m)return m[1].toUpperCase()}return null}
function snapshotIdFrom(j){return String(j?.snapshot_id||j?.snapshotId||j?.id||'')}
function validationLike(status,text){return Number(status)===400&&/validation|invalid input|request body|input.+required|must be|expected/i.test(String(text||''))}
async function waitSnapshot(key,id,{polls=60,endpoint='snapshot'}={}){
  let status='starting';for(let i=0;i<polls;i++){await sleep(i?1500:700);try{const r=await fetch(`https://api.brightdata.com/datasets/v3/progress/${encodeURIComponent(id)}`,{headers:{authorization:`Bearer ${key}`,'accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(8000)}),t=await r.text();if(!r.ok){const f=classifyBrightDataFailure({status:r.status,body:t,headers:r.headers,service:'dataset'});if(f?.code==='bright_data_no_credits')return{ok:false,snapshotId:id,httpStatus:r.status,noCredits:true,error:brightDataError('progress',f,t),endpoint};continue}const p=JSON.parse(t);status=String(p?.status||status).toLowerCase();if(status==='ready')break;if(status==='failed'){const msg=clean(p?.error||p?.message||'failed'),f=classifyBrightDataFailure({body:msg,service:'dataset'});return{ok:false,snapshotId:id,noCredits:f?.code==='bright_data_no_credits',error:f?brightDataError('snapshot',f,msg):`snapshot_failed:${msg}`,endpoint}}}catch{}}
  if(status!=='ready')return{ok:false,pending:true,snapshotId:id,error:`snapshot_${status}`,endpoint};
  let sr,text;try{sr=await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${encodeURIComponent(id)}?format=json`,{headers:{authorization:`Bearer ${key}`,'accept':'application/json'},cache:'no-store',signal:AbortSignal.timeout(15000)});text=await sr.text()}catch(e){return{ok:false,snapshotId:id,error:`download:${clean(e?.message||e)}`,endpoint}}
  if(!sr.ok){const f=classifyBrightDataFailure({status:sr.status,body:text,headers:sr.headers,service:'dataset'});return{ok:false,snapshotId:id,httpStatus:sr.status,noCredits:f?.code==='bright_data_no_credits',error:f?brightDataError('download',f,text):`download_http_${sr.status}:${clean(text).slice(0,250)}`,endpoint}}
  let data;try{data=JSON.parse(text)}catch{return{ok:false,snapshotId:id,error:`download_json:${clean(text).slice(0,250)}`,endpoint}}return{ok:true,snapshotId:id,data,endpoint}
}
async function scrape(input,{polls=60}={}){
  const key=process.env.BRIGHT_DATA_API_KEY||'';if(!key)return{ok:false,error:'api_key_missing'};
  const url=`https://api.brightdata.com/datasets/v3/scrape?dataset_id=${DATASET}&format=json&include_errors=true`,attempts=[];
  for(const candidate of[{endpoint:'scrape_object_input',body:{input:[input]}},{endpoint:'scrape_array_input',body:[input]}]){
    let r,raw;try{r=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','accept':'application/json'},body:JSON.stringify(candidate.body),cache:'no-store',signal:AbortSignal.timeout(65000)});raw=await r.text()}catch(e){attempts.push({endpoint:candidate.endpoint,error:`scrape:${clean(e?.message||e)}`});continue}
    if(!r.ok){const f=classifyBrightDataFailure({status:r.status,body:raw,headers:r.headers,service:'dataset'}),error=f?brightDataError('scrape',f,raw):`scrape_http_${r.status}:${clean(raw).slice(0,250)}`;attempts.push({endpoint:candidate.endpoint,httpStatus:r.status,error});if(validationLike(r.status,raw))continue;return{ok:false,httpStatus:r.status,noCredits:f?.code==='bright_data_no_credits',error,endpoint:candidate.endpoint,attempts}}
    let j;try{j=JSON.parse(raw)}catch{return{ok:false,error:`scrape_json:${clean(raw).slice(0,250)}`,endpoint:candidate.endpoint,attempts}}
    const id=snapshotIdFrom(j);if(id&&!Array.isArray(j)&&!Array.isArray(j?.results)&&!Array.isArray(j?.data)){const waited=await waitSnapshot(key,id,{polls,endpoint:candidate.endpoint});return{...waited,attempts:[...attempts,{endpoint:candidate.endpoint,httpStatus:r.status,snapshotId:id}]}}
    return{ok:true,data:j,endpoint:candidate.endpoint,attempts:[...attempts,{endpoint:candidate.endpoint,httpStatus:r.status}]}
  }
  return{ok:false,error:attempts.at(-1)?.error||'scrape_failed',endpoint:'scrape',attempts}
}
async function triggerSnapshot(input,{polls=60}={}){
  const key=process.env.BRIGHT_DATA_API_KEY||'';if(!key)return{ok:false,error:'api_key_missing'};
  let tr,raw;try{tr=await fetch(`https://api.brightdata.com/datasets/v3/trigger?dataset_id=${DATASET}&format=json&uncompressed_webhook=true`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json','accept':'application/json'},body:JSON.stringify([input]),cache:'no-store',signal:AbortSignal.timeout(15000)});raw=await tr.text()}catch(e){return{ok:false,error:`trigger:${clean(e?.message||e)}`}}
  if(!tr.ok){const f=classifyBrightDataFailure({status:tr.status,body:raw,headers:tr.headers,service:'dataset'});return{ok:false,httpStatus:tr.status,noCredits:f?.code==='bright_data_no_credits',error:f?brightDataError('trigger',f,raw):`trigger_http_${tr.status}:${clean(raw).slice(0,250)}`}}
  let j;try{j=JSON.parse(raw)}catch{return{ok:false,error:`trigger_json:${clean(raw).slice(0,250)}`,endpoint:'trigger'}}const id=snapshotIdFrom(j);if(!id)return{ok:false,error:`missing_snapshot:${clean(raw).slice(0,250)}`,endpoint:'trigger'};
  return await waitSnapshot(key,id,{polls,endpoint:'trigger'});
}
async function snapshot(input,options={}){
  const scraped=await scrape(input,options);
  if(scraped.ok||scraped.pending||scraped.noCredits)return scraped;
  if(!validationLike(scraped.httpStatus,scraped.error)&&!/scrape:|fetch failed|timed out|aborted|network/i.test(String(scraped.error||'')))return scraped;
  const triggered=await triggerSnapshot(input,options);
  return{...triggered,attempts:[...(scraped.attempts||[]),{endpoint:'trigger_fallback',ok:triggered.ok,httpStatus:triggered.httpStatus??null,error:triggered.error||null,snapshotId:triggered.snapshotId||null}]};
}
export async function searchAmazonProducts(keyword,{pages=2}={}){const q=clean(keyword);if(!q)return{ok:false,error:'missing_keyword',results:[]};const input={keyword:q,url:`https://www.amazon.com/s?k=${encodeURIComponent(q)}`,pages_to_search:Math.max(1,Math.min(Number(pages)||2,5))};const job=await snapshot(input);if(!job.ok)return{...job,results:[]};const rows=rowsFrom(job.data),out=[],seen=new Set();for(const x of rows){if(!x||typeof x!=='object')continue;const asin=asinFrom(x);if(!asin||seen.has(asin))continue;seen.add(asin);const title=clean(x.title||x.product_name||x.name||''),rawRatingCount=x.num_ratings??x.reviews_count??x.review_count??x.ratings_count??x.rating_count??x.reviews??x.ratings,ratingCount=count(rawRatingCount),rating=n(x.rating??x.stars??x.product_rating),image=clean(x.image||x.image_url||x.thumbnail||x.thumbnail_url||''),url=`https://www.amazon.com/dp/${asin}`;out.push({asin,url,title,ratingCount,rating,image,rankOnPage:n(x.rank_on_page),pageNumber:n(x.page_number),brand:clean(x.brand||''),ratingCountRaw:typeof rawRatingCount==='object'?JSON.stringify(rawRatingCount).slice(0,180):rawRatingCount??null,rawKeys:Object.keys(x).slice(0,60)})}return{ok:true,snapshotId:job.snapshotId,keyword:q,rawRows:rows.length,results:out.sort((a,b)=>(a.pageNumber||99)-(b.pageNumber||99)||(a.rankOnPage||999)-(b.rankOnPage||999)||((b.ratingCount||0)-(a.ratingCount||0)))}}

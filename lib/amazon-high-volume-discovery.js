import{responsesRequest,hasAIProvider}from'./gateway';
import{amazonAsinV2,isAmazonV2}from'./amazon-review-ingest-v2';

const MODEL='openai/gpt-5.6-sol';
const clean=x=>String(x??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
function count(v){if(v==null)return null;const m=String(v).toLowerCase().replace(/,/g,'').match(/([0-9]+(?:\.\d+)?)\s*([kmb])?/);if(!m)return null;let n=Number(m[1]);n*=m[2]==='k'?1e3:m[2]==='m'?1e6:m[2]==='b'?1e9:1;return Number.isFinite(n)?Math.round(n):null}
function extractText(j){if(typeof j?.output_text==='string')return j.output_text;for(const o of j?.output||[])for(const c of o?.content||[])if(typeof c?.text==='string')return c.text;return''}
function parseObject(s){s=String(s||'').replace(/```(?:json)?/gi,'').replace(/```/g,'');const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a<0||b<a)throw Error('invalid_model_json');return JSON.parse(s.slice(a,b+1))}
function sourceClues(referenceSet){const rows=[...(referenceSet?.sourceCounts||[]),...(referenceSet?.aggregateOnlySources||[])],seen=new Set(),out=[];for(const x of rows.sort((a,b)=>(Number(b.matchConfidence)||0)-(Number(a.matchConfidence)||0)||(Number(a.lensRank)||999)-(Number(b.lensRank)||999))){const title=clean(x.title||x.sourceTitle||'');const u=clean(x.directSourceUrl||x.sourceUrl||'');const key=`${title}|${u}`;if(seen.has(key))continue;seen.add(key);if(!title&&!u)continue;out.push({title:title.slice(0,260),url:u,platform:x.platform||'',matchConfidence:x.matchConfidence??null,lensTabs:x.lensTabs||[],lensRank:x.lensRank??null});if(out.length>=14)break}return out}
function normalizeAmazonCandidate(x){const u=clean(x?.url||x?.amazonUrl||''),asin=clean(x?.asin||amazonAsinV2(u)).toUpperCase();if(!asin||!isAmazonV2(u||`https://www.amazon.com/dp/${asin}`))return null;const url=`https://www.amazon.com/dp/${asin}`,confidence=Number(x?.matchConfidence);return{url,asin,title:clean(x?.title||x?.productTitle||'').slice(0,260),matchConfidence:Number.isFinite(confidence)?Math.max(0,Math.min(1,confidence)):null,matchReason:clean(x?.matchReason||x?.reason||'').slice(0,500),ratingCountEstimate:count(x?.ratingCountEstimate??x?.reviewCountEstimate??x?.ratings??x?.reviews),ratingEstimate:Number.isFinite(Number(x?.ratingEstimate))?Number(x.ratingEstimate):null,queries:Array.isArray(x?.queries)?x.queries.slice(0,8):[]}}

export async function discoverHighVolumeAmazon(req,{referenceSet,productTitle='',productDescription=''}={}){
  if(!hasAIProvider(req))return{candidates:[],diagnostics:{error:'no_ai_provider_credential'}};
  const clues=sourceClues(referenceSet),title=clean(productTitle||referenceSet?.productTitle||''),desc=clean(productDescription||referenceSet?.productDescription||'').slice(0,7000);
  const prompt=`You are resolving an ecommerce product to its best AMAZON.COM listing for INTERNAL QA MODELING. The product may be sold under different private-label brands. SAME PHYSICAL PRODUCT is mandatory; review volume is only a tie-breaker after identity is established.

Use public web search. Perform multiple searches, not just one. Start from distinctive phrases and model/feature combinations in the strongest verified source titles below. Search site:amazon.com using exact phrases, then remove/private-label brand names and search the distinctive physical-product wording. Look for Amazon listings with high public rating/review counts, but NEVER substitute a merely similar product just because it has more reviews.

SOURCE PRODUCT TITLE: ${title||'unknown'}
SOURCE PRODUCT FACTS: ${desc||'not provided'}
VERIFIED SOURCE CLUES: ${JSON.stringify(clues)}

For each Amazon candidate, verify from public indexed evidence that its title/features correspond to the SAME physical product/private-label equivalent. Prefer exact Amazon /dp/ URLs and canonical ASINs. Never invent URLs, ASINs, counts, or confidence. Return null instead of guessing.

Return ONLY JSON:
{"queries":["actual searches used"],"candidates":[{"url":"https://www.amazon.com/dp/...","asin":"B0...","title":"indexed Amazon title","matchConfidence":0.0,"matchReason":"specific identity evidence","ratingCountEstimate":null,"ratingEstimate":null}]}

Return at most 6 candidates, sorted first by SAME-PRODUCT confidence and then by public rating/review volume.`;
  let j,provider='';try{const r=await responsesRequest(req,{model:MODEL,reasoning:{effort:'medium'},input:prompt,tools:[{type:'web_search',search_context_size:'high'}],tool_choice:'required',include:['web_search_call.action.sources','web_search_call.results'],store:false},75000);j=r.json;provider=r.provider}catch(e){return{candidates:[],diagnostics:{error:clean(e?.message||e)}}}
  let parsed={};try{parsed=parseObject(extractText(j))}catch(e){return{candidates:[],diagnostics:{provider,error:`parse:${clean(e?.message||e)}`,output:extractText(j).slice(0,1000)}}}
  const map=new Map();for(const x of parsed.candidates||[]){const c=normalizeAmazonCandidate(x);if(!c)continue;const old=map.get(c.asin);if(!old||(c.matchConfidence||0)>(old.matchConfidence||0)||(c.ratingCountEstimate||0)>(old.ratingCountEstimate||0))map.set(c.asin,c)}
  const candidates=[...map.values()].filter(x=>(x.matchConfidence??0)>=.72).sort((a,b)=>(b.matchConfidence-a.matchConfidence)||((b.ratingCountEstimate||0)-(a.ratingCountEstimate||0))).slice(0,6);
  return{queries:Array.isArray(parsed.queries)?parsed.queries.slice(0,20):[],candidates,clues,diagnostics:{provider,webSearchCalls:(j?.output||[]).filter(x=>x?.type==='web_search_call').length,rawCandidates:Array.isArray(parsed.candidates)?parsed.candidates.length:0,acceptedCandidates:candidates.length}};
}

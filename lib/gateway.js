export const MODEL='openai/gpt-5.6-sol';
const GATEWAY_URL='https://ai-gateway.vercel.sh/v1/responses';
const OPENAI_URL='https://api.openai.com/v1/responses';
export function gatewayToken(req){return req?.headers?.get?.('x-vercel-oidc-token')||process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN||''}
export function directOpenAIToken(){return process.env.OPENAI_API_KEY||''}
export function hasAIProvider(req){return Boolean(gatewayToken(req)||directOpenAIToken())}
export function authMode(req){return req?.headers?.get?.('x-vercel-oidc-token')?'oidc-header':process.env.AI_GATEWAY_API_KEY?'api-key':process.env.VERCEL_OIDC_TOKEN?'oidc-env':process.env.OPENAI_API_KEY?'direct-openai':'none'}
function extractText(j){
  if(typeof j?.output_text==='string'&&j.output_text.trim())return j.output_text;
  if(Array.isArray(j?.output))for(const o of j.output||[])for(const c of o?.content||[])if(typeof c?.text==='string'&&c.text.trim())return c.text;
  if(typeof j?.text==='string')return j.text;
  return '';
}
function clean(x){return String(x||'').replace(/\s+/g,' ').trim()}
async function call(url,token,body,timeout,label){
  let r;try{r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)})}catch(err){throw Error(`${label} request failed before a response: ${err?.message||err}`)}
  const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{j=null}
  if(!r.ok){const msg=j?.error?.message||j?.message||raw.slice(0,500)||`HTTP ${r.status}`;throw Error(`${label} ${r.status}: ${clean(msg)}`)}
  if(!j||typeof j!=='object')throw Error(`${label} returned invalid JSON.`);return j
}
function directModel(body){return process.env.OPENAI_DIRECT_MODEL||'gpt-5.6'}
export async function responsesRequest(req,body,timeout=75000){
  const errors=[],gt=gatewayToken(req);
  if(gt){try{return{json:await call(GATEWAY_URL,gt,body,timeout,'AI Gateway'),provider:'vercel_ai_gateway'}}catch(e){errors.push(e?.message||String(e))}}
  const ot=directOpenAIToken();
  if(ot){try{return{json:await call(OPENAI_URL,ot,{...body,model:directModel(body)},timeout,'OpenAI API'),provider:'openai_direct'}}catch(e){errors.push(e?.message||String(e))}}
  if(!gt&&!ot)throw Error('No AI provider credential is available in this deployment.');
  throw Error(errors.join(' | ')||'All AI providers failed.');
}
export async function gateway(req,prompt,timeout=75000){
  const{json,provider}=await responsesRequest(req,{model:MODEL,input:prompt},timeout),text=extractText(json);if(!text)throw Error(`${provider} returned an empty response.`);return{text,raw:json,provider};
}

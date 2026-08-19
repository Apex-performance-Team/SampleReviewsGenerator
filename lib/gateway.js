export const MODEL='openai/gpt-5.6-sol';
const URL='https://ai-gateway.vercel.sh/v1/responses';
export function gatewayToken(req){return req?.headers?.get?.('x-vercel-oidc-token')||process.env.AI_GATEWAY_API_KEY||process.env.VERCEL_OIDC_TOKEN||''}
export function authMode(req){return req?.headers?.get?.('x-vercel-oidc-token')?'oidc-header':process.env.AI_GATEWAY_API_KEY?'api-key':process.env.VERCEL_OIDC_TOKEN?'oidc-env':'none'}
function extractText(j){
  if(typeof j?.output_text==='string'&&j.output_text.trim())return j.output_text;
  if(Array.isArray(j?.output))for(const o of j.output||[])for(const c of o?.content||[])if(typeof c?.text==='string'&&c.text.trim())return c.text;
  if(typeof j?.text==='string')return j.text;
  return '';
}
export async function gateway(req,prompt,timeout=75000){
  const token=gatewayToken(req);if(!token)throw Error('No AI Gateway credential is available in this deployment.');
  let r;try{r=await fetch(URL,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({model:MODEL,input:prompt}),signal:AbortSignal.timeout(timeout)})}catch(err){throw Error(`AI Gateway request failed before a response: ${err?.message||err}`)}
  const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{j=null}
  if(!r.ok){const msg=j?.error?.message||j?.message||raw.slice(0,500)||`HTTP ${r.status}`;throw Error(`AI Gateway ${r.status}: ${msg}`)}
  const text=extractText(j);if(!text)throw Error('AI Gateway returned an empty response.');return{text,raw:j};
}

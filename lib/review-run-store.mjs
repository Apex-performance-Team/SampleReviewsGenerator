import fs from'node:fs/promises';
import path from'node:path';

const LOCAL_FILE=path.join('/tmp','synthetic-review-lab-runs.json');
const TABLE='review_runs';

function now(){return new Date().toISOString()}
function supabaseConfig(){
  const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SERVICE_KEY;
  return url&&key?{url:url.replace(/\/+$/,''),key}:null;
}
function cleanRun(row){
  return{
    id:row.id,status:row.status,mode:row.mode,product_title:row.product_title||'',product_url:row.product_url||'',requested_count:Number(row.requested_count)||0,completed_count:Number(row.completed_count)||0,purged_count:Number(row.purged_count)||0,current_step:row.current_step||'',progress_message:row.progress_message||'',error:row.error||null,input_json:row.input_json||{},result_json:row.result_json||{},created_at:row.created_at,updated_at:row.updated_at,completed_at:row.completed_at||null
  };
}
async function supabase(pathname,{method='GET',body,headers={}}={}){
  const cfg=supabaseConfig();if(!cfg)throw Error('Supabase is not configured.');
  const res=await fetch(`${cfg.url}/rest/v1/${pathname}`,{method,headers:{apikey:cfg.key,authorization:`Bearer ${cfg.key}`,'content-type':'application/json',...headers},body:body==null?undefined:JSON.stringify(body),cache:'no-store'});
  const text=await res.text();
  if(!res.ok)throw Error(`Supabase ${method} ${pathname} failed (${res.status}): ${text.slice(0,500)}`);
  return text?JSON.parse(text):null;
}
async function readLocal(){
  try{return JSON.parse(await fs.readFile(LOCAL_FILE,'utf8'))}catch{return[]}
}
async function writeLocal(rows){
  await fs.writeFile(LOCAL_FILE,JSON.stringify(rows,null,2));
}
export function runStoreMode(){return supabaseConfig()?'supabase':'local_tmp'}
export async function listRuns(limit=50){
  if(supabaseConfig()){
    const rows=await supabase(`${TABLE}?select=*&order=created_at.desc&limit=${Math.max(1,Math.min(100,Number(limit)||50))}`);
    return rows.map(cleanRun);
  }
  const rows=await readLocal();
  return rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,limit).map(cleanRun);
}
export async function listCatalogRuns(limit=20,{statuses=[]}={}){
  const take=Math.max(1,Math.min(50,Number(limit)||20)),allowed=[...new Set(statuses)].filter(status=>['queued','running','completed','failed','canceled'].includes(status)),statusFilter=allowed.length?`&status=in.(${allowed.join(',')})`:'';
  if(supabaseConfig()){
    const rows=await supabase(`${TABLE}?input_json->>catalogRun=eq.true${statusFilter}&select=*&order=created_at.desc&limit=${take}`);
    return rows.map(cleanRun);
  }
  const rows=await readLocal();
  return rows.filter(row=>row.input_json?.catalogRun&&(!allowed.length||allowed.includes(row.status))).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,take).map(cleanRun);
}
export async function getRun(id){
  if(!id)throw Error('Missing run id.');
  if(supabaseConfig()){
    const rows=await supabase(`${TABLE}?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
    if(!rows?.length)throw Error('Run not found.');
    return cleanRun(rows[0]);
  }
  const rows=await readLocal(),row=rows.find(x=>x.id===id);
  if(!row)throw Error('Run not found.');
  return cleanRun(row);
}
export async function getRuns(ids){
  const wanted=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!wanted.length)return[];
  if(supabaseConfig()){
    const safe=wanted.filter(x=>/^[a-zA-Z0-9_-]{1,100}$/.test(x));
    if(safe.length!==wanted.length)throw Error('Invalid run id.');
    const rows=await supabase(`${TABLE}?id=in.(${safe.map(encodeURIComponent).join(',')})&select=*`),byId=new Map(rows.map(row=>[row.id,cleanRun(row)]));
    return wanted.map(id=>byId.get(id)).filter(Boolean);
  }
  const rows=await readLocal(),byId=new Map(rows.map(row=>[row.id,cleanRun(row)]));
  return wanted.map(id=>byId.get(id)).filter(Boolean);
}
export async function createRun(input,{id:providedId}={}){
  const id=providedId||globalThis.crypto?.randomUUID?.()||`run_${Date.now()}_${Math.random().toString(16).slice(2)}`,created=now(),row={
    id,status:'queued',mode:input.mode||'pdp_only',product_title:input.productTitle||'',product_url:input.productUrl||'',requested_count:Number(input.reviewCount)||0,completed_count:0,purged_count:0,current_step:'queued',progress_message:'Queued',error:null,input_json:input,result_json:{reviews:[],purgedReviews:[],steps:[]},created_at:created,updated_at:created,completed_at:null
  };
  if(supabaseConfig()){
    const rows=await supabase(TABLE,{method:'POST',body:row,headers:{prefer:'return=representation'}});
    return cleanRun(rows[0]);
  }
  const rows=await readLocal();rows.push(row);await writeLocal(rows);return cleanRun(row);
}
export async function updateRun(id,patch){
  const body={...patch,updated_at:now()};
  if(supabaseConfig()){
    const preserveCancellation=patch.status!=='canceled',rows=await supabase(`${TABLE}?id=eq.${encodeURIComponent(id)}${preserveCancellation?'&status=neq.canceled':''}`,{method:'PATCH',body,headers:{prefer:'return=representation'}});
    if(!rows?.length){
      const current=await getRun(id);
      if(current.status==='canceled')return current;
      throw Error('Run not found.');
    }
    return cleanRun(rows[0]);
  }
  const rows=await readLocal(),i=rows.findIndex(x=>x.id===id);
  if(i<0)throw Error('Run not found.');
  if(rows[i].status==='canceled'&&patch.status!=='canceled')return cleanRun(rows[i]);
  rows[i]={...rows[i],...body};await writeLocal(rows);return cleanRun(rows[i]);
}
export async function cancelRuns(ids,progressMessage='Canceled by user.'){
  const wanted=[...new Set((Array.isArray(ids)?ids:[]).map(x=>String(x||'').trim()).filter(Boolean))];
  if(!wanted.length)return[];
  const safe=wanted.filter(x=>/^[a-zA-Z0-9_-]{1,100}$/.test(x));
  if(safe.length!==wanted.length)throw Error('Invalid run id.');
  const stopped=now(),body={status:'canceled',current_step:'canceled',progress_message:String(progressMessage||'Canceled by user.').slice(0,1000),error:null,updated_at:stopped,completed_at:stopped};
  if(supabaseConfig()){
    const rows=await supabase(`${TABLE}?id=in.(${safe.map(encodeURIComponent).join(',')})&status=in.(queued,running)`,{method:'PATCH',body,headers:{prefer:'return=representation'}});
    return (rows||[]).map(cleanRun);
  }
  const rows=await readLocal(),wantedIds=new Set(safe),changed=[];
  for(let i=0;i<rows.length;i++)if(wantedIds.has(rows[i].id)&&['queued','running'].includes(rows[i].status)){
    rows[i]={...rows[i],...body};changed.push(cleanRun(rows[i]));
  }
  if(changed.length)await writeLocal(rows);
  return changed;
}
export async function claimQueuedRun(id,patch={}){
  const body={...patch,status:'running',updated_at:now()};
  if(supabaseConfig()){
    const rows=await supabase(`${TABLE}?id=eq.${encodeURIComponent(id)}&status=eq.queued`,{method:'PATCH',body,headers:{prefer:'return=representation'}});
    return rows?.length?cleanRun(rows[0]):null;
  }
  const rows=await readLocal(),i=rows.findIndex(x=>x.id===id&&x.status==='queued');
  if(i<0)return null;
  rows[i]={...rows[i],...body};await writeLocal(rows);return cleanRun(rows[i]);
}

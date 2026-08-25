'use client';
import{useCallback,useEffect,useMemo,useRef,useState}from'react';

const start={mode:'pdp_only',productUrl:'',amazonListingUrl:'',productTitle:'',productDescription:'',reviewCount:50,targetAverage:4.7,referenceBudget:'balanced'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fmtDate=value=>value?new Date(value).toLocaleString():'—';
const statusLabel=run=>`${run.completed_count||0}/${run.requested_count||0}${run.purged_count?` · ${run.purged_count} purged`:''}`;

export default function RunsPage(){
  const[form,setForm]=useState(start),[runs,setRuns]=useState([]),[selected,setSelected]=useState(null),[store,setStore]=useState(''),[busy,setBusy]=useState(false),[auto,setAuto]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[accessKey,setAccessKey]=useState(''),[locked,setLocked]=useState('checking');
  const stopRef=useRef(false);
  const set=(key,value)=>setForm(current=>({...current,[key]:value}));
  const selectedRun=useMemo(()=>runs.find(run=>run.id===selected)||null,[runs,selected]);
  const canExport=selectedRun?.status==='completed';
  const refresh=useCallback(async()=>{
    setError('');
    const res=await fetch('/api/review-runs',{cache:'no-store'});
    const json=await res.json().catch(()=>({}));
    if(res.status===401){setLocked('locked');setRuns([]);setStore('');return json}
    if(res.status===503){setLocked('unconfigured');setRuns([]);setStore('');throw Error(json.error||'Server run access is not configured.')}
    if(!res.ok)throw Error(json.error||'Could not load server runs.');
    setLocked('ready');
    setRuns(json.runs||[]);
    setStore(json.store||'');
    if(!selected&&json.runs?.[0])setSelected(json.runs[0].id);
    return json;
  },[selected]);
  useEffect(()=>{refresh().catch(err=>setError(err.message))},[refresh]);
  async function unlock(event){
    event.preventDefault();setBusy(true);setError('');
    try{
      const res=await fetch('/api/review-runs/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessKey})});
      const json=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(json.error||'Could not unlock server runs.');
      setAccessKey('');setLocked('ready');await refresh();
    }catch(err){setLocked('locked');setError(err.message)}
    finally{setBusy(false)}
  }
  async function lock(){
    setBusy(true);
    try{await fetch('/api/review-runs/session',{method:'DELETE'});}
    finally{setRuns([]);setSelected(null);setLocked('locked');setBusy(false)}
  }
  async function createRun(event){
    event.preventDefault();setBusy(true);setError('');setNotice('');
    try{
      const res=await fetch('/api/review-runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...form,reviewCount:Number(form.reviewCount),targetAverage:Number(form.targetAverage)})});
      const json=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(json.error||'Could not create server run.');
      setSelected(json.run.id);
      setNotice('Server run created. It is safe to leave and resume it later.');
      await refresh();
    }catch(err){setError(err.message)}
    finally{setBusy(false)}
  }
  async function processOnce(id=selected){
    if(!id)return null;
    setBusy(true);setError('');setNotice('');
    try{
      const res=await fetch(`/api/review-runs/${id}/process`,{method:'POST',cache:'no-store'});
      const json=await res.json().catch(()=>({}));
      if(!res.ok)throw Error(json.error||'Could not process run.');
      await refresh();
      return json.run;
    }catch(err){setError(err.message);return null}
    finally{setBusy(false)}
  }
  async function autoRun(){
    if(!selected)return;
    stopRef.current=false;setAuto(true);setNotice('Auto-run started. If the browser sleeps, the saved run can still be resumed from this page.');
    let current=selectedRun;
    for(let i=0;i<80&&!stopRef.current;i++){
      if(current&&['completed','failed','canceled'].includes(current.status))break;
      current=await processOnce(selected);
      if(!current||['completed','failed','canceled'].includes(current.status))break;
      await sleep(900);
    }
    setAuto(false);
  }
  function stopAuto(){stopRef.current=true;setAuto(false);setNotice('Auto-run stopped. Current server progress is saved.')}
  if(locked!=='ready')return <main><header><b>SR</b><span>Synthetic Review Lab</span><i>Server runs</i></header><section className="wrap"><div className={`health ${locked==='checking'?'':'bad'}`}><div><b>Run storage</b><span>{locked==='checking'?'Checking access…':locked==='unconfigured'?'Server run access is not configured.':'Server runs are locked.'}</span></div><div className="actions"><a className="ghost" href="/">Generator</a></div></div><div className="hero"><div><small>PRIVATE SERVER RUNS</small><h1>Unlock server-side review runs.</h1><p>Run inputs and generated outputs are persisted, so this area is protected by the admin access key.</p></div><aside><span>Access</span><strong>{locked==='checking'?'…':'Locked'}</strong><em>HttpOnly session cookie</em></aside></div>{locked!=='unconfigured'&&<section className="panel"><form onSubmit={unlock}><label>Admin access key<input type="password" autoComplete="off" spellCheck="false" value={accessKey} onChange={event=>setAccessKey(event.target.value)} placeholder="Enter access key" required/></label><div className="formActions"><button className="primary" disabled={busy}>{busy?'Unlocking…':'Unlock server runs'}</button></div></form></section>}{error&&<div className="error">{error}</div>}</section></main>;
  return <main><header><b>SR</b><span>Synthetic Review Lab</span><i>Server runs</i></header><section className="wrap"><div className={`health ${store==='supabase'?'good':'bad'}`}><div><b>Run storage</b><span>{store==='supabase'?'Supabase durable storage active':store==='local_tmp'?'Local temp fallback active. Production needs Supabase env vars for team durability.':'Checking storage…'}</span></div><div className="actions"><a className="ghost" href="/">Generator</a><button className="ghost" onClick={()=>refresh().catch(err=>setError(err.message))}>Refresh</button><button className="ghost" onClick={lock} disabled={busy}>Lock</button></div></div><div className="hero"><div><small>TEAM-SAFE SERVER QUEUE</small><h1>Run review jobs from the server, then resume or export later.</h1><p>This page creates persisted run records and advances generation in recoverable server steps. Browser sleep can interrupt auto-run polling, but it should not erase the run or final output.</p></div><aside><span>Selected run</span><strong>{selectedRun?selectedRun.status:'—'}</strong><em>{selectedRun?statusLabel(selectedRun):'No run selected'}</em></aside></div>{notice&&<div className="qaNotice"><b>Status</b><span>{notice}</span></div>}{error&&<div className="error">{error}</div>}<section className="panel"><div className="scannerHead"><h2>Create server run</h2><div className="tabs"><button type="button" className={form.mode==='pdp_only'?'active':''} onClick={()=>set('mode','pdp_only')}>PDP-only</button><button type="button" className={form.mode==='source_rewrite'?'active':''} onClick={()=>set('mode','source_rewrite')}>Source rewrite</button></div></div><form onSubmit={createRun}><label>Shopify product URL<input value={form.productUrl} onChange={event=>set('productUrl',event.target.value)} placeholder="https://store.com/products/product"/></label><label>Verified Amazon starting source <small>(optional)</small><input value={form.amazonListingUrl} onChange={event=>set('amazonListingUrl',event.target.value)} placeholder="https://www.amazon.com/dp/ASIN"/></label><label>Product title <small>(optional if URL is provided)</small><input value={form.productTitle} onChange={event=>set('productTitle',event.target.value)} placeholder="Product title from Shopify listing"/></label><label>Product context <small>(optional if URL is provided)</small><textarea rows="8" value={form.productDescription} onChange={event=>set('productDescription',event.target.value)} placeholder="Paste PDP context when creating a run without a URL."/></label><div className="grid"><label>Review count<input type="number" min="5" max="250" value={form.reviewCount} onChange={event=>set('reviewCount',event.target.value)}/></label><label>Target average<input type="number" min="1" max="5" step=".1" value={form.targetAverage} onChange={event=>set('targetAverage',event.target.value)}/></label><label>Reference budget<select value={form.referenceBudget} onChange={event=>set('referenceBudget',event.target.value)}><option value="test">Test</option><option value="balanced">Balanced</option><option value="thorough">Thorough</option></select></label></div><div className="generationBudget"><b>{form.mode==='source_rewrite'?'Source rewrite mode':'PDP-only mode'}</b><span>{form.mode==='source_rewrite'?'Find marketplace review bodies, rewrite what each source review actually says, and purge mismatches/failed rewrites from final output.':'Skip Lens/Amazon and use the PDP generator path with the heavier synthetic review logic.'}</span></div><div className="formActions"><button className="primary" disabled={busy}>{busy?'Working…':'Create server run'}</button></div></form></section><section className="panel" style={{marginTop:20}}><div className="scannerHead"><h2>Runs</h2><div className="actions">{selectedRun&&<><button className="ghost" disabled={busy||auto||['completed','canceled'].includes(selectedRun.status)} onClick={()=>processOnce()}>{busy?'Processing…':'Process next step'}</button>{auto?<button className="ghost" onClick={stopAuto}>Stop auto-run</button>:<button disabled={busy||!selectedRun||['completed','failed','canceled'].includes(selectedRun.status)} onClick={autoRun}>Auto-run selected</button>}{canExport&&<a className="ghost" href={`/api/review-runs/${selectedRun.id}/export.csv`}>Export CSV</a>}</>}</div></div><div className="catalog">{runs.length?runs.map(run=><button key={run.id} type="button" className={`item ${selected===run.id?'done':''}`} style={{width:'100%',textAlign:'left',background:'transparent',color:'inherit',border:0,borderBottom:'1px solid #222a32',borderRadius:0}} onClick={()=>setSelected(run.id)}><span className="dot"/><div><div className="titleLine"><b>{run.product_title||run.input_json?.productTitle||'Untitled product'}</b><span className="badge">{run.status}</span><span className="badge">{run.mode}</span></div><small>{run.product_url||run.input_json?.productUrl||'No URL'} · {fmtDate(run.created_at)}</small><small>{run.current_step||'queued'} · {run.progress_message||''}{run.error?` · ${run.error}`:''}</small></div><div className={`reviewCount ${run.completed_count?'known':''}`}><span>Progress</span><strong>{statusLabel(run)}</strong></div></button>):<div className="item"><span className="dot"/><div><b>No runs yet</b><small>Create a server run above.</small></div></div>}</div></section>{selectedRun&&<section className="stats"><article><span>Status</span><strong>{selectedRun.status}</strong><small>{selectedRun.current_step||'—'}</small></article><article><span>Final reviews</span><strong>{selectedRun.completed_count||0}</strong><small>requested {selectedRun.requested_count||0}</small></article><article><span>Purged</span><strong>{selectedRun.purged_count||0}</strong><small>removed from final CSV</small></article></section>}</section></main>
}

'use client';

import{useEffect,useRef,useState}from'react';

const EMPTY_BASELINE={vercel:null,brightData:null};
function money(value){return Number.isFinite(Number(value))?`$${Number(value).toFixed(2)}`:'—'}
function providerStatus(provider){
  if(!provider?.configured)return'Not configured';
  if(provider?.permissionRequired)return'Balance permission required';
  if(provider?.ok===false)return'Unavailable';
  if(provider?.ok===null)return'Check failed';
  return money(provider?.balance);
}
function spent(before,now){
  if(!Number.isFinite(Number(before))||!Number.isFinite(Number(now)))return null;
  return Math.max(0,Number(before)-Number(now));
}
function timeLabel(value){
  if(!value)return'';
  try{return new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(value))}catch{return''}
}

export default function CreditBalanceBar(){
  const[state,setState]=useState('loading'),[data,setData]=useState(null),[accessKey,setAccessKey]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),baseline=useRef({...EMPTY_BASELINE});
  function rememberBaseline(value){
    if(baseline.current.vercel===null&&Number.isFinite(Number(value?.vercel?.balance)))baseline.current.vercel=Number(value.vercel.balance);
    if(baseline.current.brightData===null&&Number.isFinite(Number(value?.brightData?.balance)))baseline.current.brightData=Number(value.brightData.balance);
  }
  async function refresh({quiet=false}={}){
    if(!quiet)setBusy(true);
    try{
      const response=await fetch('/api/credit-balances',{cache:'no-store'}),value=await response.json();
      if(response.status===401){setState('locked');setData(null);return}
      if(response.status===503){setState('unconfigured');setError(value.error||'Credit monitor access is not configured.');return}
      if(!response.ok)throw Error(value.error||'Credit check failed.');
      rememberBaseline(value);setData(value);setState('ready');setError('');
    }catch(reason){setState(current=>current==='ready'?'ready':'error');setError(reason?.message||'Credit check failed.')}finally{if(!quiet)setBusy(false)}
  }
  async function unlock(event){
    event.preventDefault();setBusy(true);setError('');
    try{
      const response=await fetch('/api/credit-balances',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessKey})}),value=await response.json();
      if(!response.ok)throw Error(value.error||'Unable to unlock the credit monitor.');
      baseline.current={...EMPTY_BASELINE};rememberBaseline(value);setData(value);setAccessKey('');setState('ready');
    }catch(reason){setState('locked');setError(reason?.message||'Unable to unlock the credit monitor.')}finally{setBusy(false)}
  }
  async function lock(){
    setBusy(true);try{await fetch('/api/credit-balances',{method:'DELETE'});}finally{baseline.current={...EMPTY_BASELINE};setData(null);setState('locked');setBusy(false)}
  }
  useEffect(()=>{refresh()},[]);
  useEffect(()=>{if(state!=='ready')return;const id=setInterval(()=>refresh({quiet:true}),60000);return()=>clearInterval(id)},[state]);

  if(state==='loading')return <aside className="creditMonitor creditMonitorCompact"><b>Credit monitor</b><span>Checking access…</span></aside>;
  if(state!=='ready')return <aside className="creditMonitor creditMonitorLocked"><div><b>Credit monitor</b><span>{state==='unconfigured'?'Setup required':'Balances are locked'}</span></div>{state!=='unconfigured'&&<form onSubmit={unlock}><label htmlFor="credit-access-key">Admin access key</label><input id="credit-access-key" type="password" autoComplete="off" spellCheck="false" value={accessKey} onChange={event=>setAccessKey(event.target.value)} placeholder="Enter access key" required/><button className="ghost" disabled={busy}>{busy?'Unlocking…':'Unlock'}</button></form>}{error&&<small className="creditError">{error}</small>}</aside>;

  const vercelSpend=spent(baseline.current.vercel,data?.vercel?.balance),brightSpend=spent(baseline.current.brightData,data?.brightData?.balance),totalSpend=[vercelSpend,brightSpend].filter(Number.isFinite).reduce((sum,value)=>sum+value,0);
  return <aside className="creditMonitor"><div className="creditTitle"><div><b>Live credit monitor</b><span>Private admin view · refreshes every {data.refreshSeconds||60}s</span></div><div className="creditActions"><small>{timeLabel(data.checkedAt)&&`Updated ${timeLabel(data.checkedAt)}`}</small><button className="ghost" onClick={()=>refresh()} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button><button className="ghost" onClick={lock} disabled={busy}>Lock</button></div></div><div className="creditGrid"><article><span>Vercel AI Gateway</span><strong>{providerStatus(data.vercel)}</strong><small>Since unlock: {vercelSpend===null?'—':money(vercelSpend)}</small>{data.vercel?.error&&<em>{data.vercel.error}</em>}</article><article><span>Bright Data</span><strong>{providerStatus(data.brightData)}</strong><small>Since unlock: {brightSpend===null?'—':money(brightSpend)}{Number.isFinite(Number(data.brightData?.pendingBalance))?` · Pending ${money(data.brightData.pendingBalance)}`:''}</small>{data.brightData?.error&&<em>{data.brightData.error}</em>}</article><article className="creditTotal"><span>Combined spend</span><strong>{money(totalSpend)}</strong><small>Measured since this panel was unlocked</small></article></div>{error&&<small className="creditError">{error}</small>}</aside>;
}

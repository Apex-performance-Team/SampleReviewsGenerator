'use client';
import{useEffect,useState}from'react';
function money(v){return Number.isFinite(Number(v))?`$${Number(v).toFixed(2)}`:'—'}
function status(x){if(!x?.configured)return'Not configured';if(x?.permissionRequired)return'Permission required';if(x?.ok===false)return x?.error||'Unavailable';if(x?.ok===null)return'Check failed';return money(x?.balance)}
function keyLabel(b){return b?.balanceKeyMode==='finance-key'?'Dedicated balance key':'Scraping key'}
function authHint(b){if(!b||b.ok!==false)return null;const e=String(b.error||'').toLowerCase();if(!/invalid|unauthorized|auth/.test(e))return null;return b.balanceKeyMode==='finance-key'?'The dedicated BRIGHT_DATA_BALANCE_API_KEY is being rejected. Replace it with a valid Bright Data API key or remove that variable to fall back to the scraping key.':'The existing BRIGHT_DATA_API_KEY is being rejected by the Bright Data balance endpoint.'}
export default function CreditBalanceBar(){
  const[data,setData]=useState(null),[loading,setLoading]=useState(true);
  async function refresh(){setLoading(true);try{const r=await fetch('/api/credit-balances',{cache:'no-store'}),j=await r.json();setData(j)}catch(e){setData({error:e.message})}finally{setLoading(false)}}
  useEffect(()=>{refresh();const id=setInterval(refresh,60000);return()=>clearInterval(id)},[]);
  const v=data?.vercel,b=data?.brightData,hint=authHint(b);
  return <div style={{maxWidth:1180,margin:'14px auto 0',padding:'0 20px'}}>
    <div style={{display:'flex',gap:10,alignItems:'stretch',flexWrap:'wrap'}}>
      <div style={{flex:'1 1 260px',border:'1px solid rgba(255,255,255,.12)',borderRadius:12,padding:'12px 14px',background:'rgba(255,255,255,.03)'}}>
        <div style={{fontSize:12,opacity:.65,marginBottom:4}}>Vercel AI Gateway credits</div>
        <div style={{fontSize:20,fontWeight:700}}>{loading&&!data?'Checking…':status(v)}</div>
        {v?.authMode&&<div style={{fontSize:11,opacity:.55,marginTop:4}}>Auth: {v.authMode}</div>}
      </div>
      <div style={{flex:'1 1 260px',border:'1px solid rgba(255,255,255,.12)',borderRadius:12,padding:'12px 14px',background:'rgba(255,255,255,.03)'}}>
        <div style={{fontSize:12,opacity:.65,marginBottom:4}}>Bright Data credits</div>
        <div style={{fontSize:20,fontWeight:700}}>{loading&&!data?'Checking…':status(b)}</div>
        {b&&<div style={{fontSize:11,opacity:.55,marginTop:4}}>Using: {keyLabel(b)}</div>}
        {hint&&<div style={{fontSize:11,opacity:.7,marginTop:4}}>{hint}</div>}
        {b?.permissionRequired?<div style={{fontSize:11,opacity:.7,marginTop:4}}>Balance read access is missing. <a href={b.permissionsUrl||'https://brightdata.com/cp/setting/users'} target="_blank" rel="noreferrer" style={{color:'inherit',textDecoration:'underline'}}>Open Bright Data settings</a></div>:Number.isFinite(Number(b?.pendingBalance))&&<div style={{fontSize:11,opacity:.55,marginTop:4}}>Pending: {money(b.pendingBalance)}</div>}
      </div>
      <button onClick={refresh} disabled={loading} style={{alignSelf:'center',padding:'10px 14px',borderRadius:10,border:'1px solid rgba(255,255,255,.14)',background:'transparent',color:'inherit',cursor:loading?'default':'pointer'}}>{loading?'Refreshing…':'Refresh credits'}</button>
    </div>
  </div>
}

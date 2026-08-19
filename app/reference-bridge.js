'use client';
import{useEffect,useRef,useState}from'react';

export default function ReferenceBridge(){
  const enabledRef=useRef(true),configuredRef=useRef(false),cache=useRef(new Map()),inflight=useRef(new Map());
  const[enabled,setEnabledState]=useState(true),[info,setInfo]=useState({status:'checking',text:'Checking AI Gateway reference search…'});
  const setEnabled=v=>{enabledRef.current=v;setEnabledState(v)};
  useEffect(()=>{
    let alive=true;
    const original=window.fetch.bind(window);
    const setSafe=x=>{if(alive)setInfo(x)};
    original('/api/reference-health',{cache:'no-store'}).then(r=>r.json()).then(j=>{
      configuredRef.current=Boolean(j.configured);
      setSafe(j.configured?{status:'ready',text:`Ready · ${j.provider||'AI Gateway reference search'} · runs once per SKU`}:{status:'missing',text:'Unavailable · AI Gateway authentication is not available in this deployment'});
    }).catch(e=>setSafe({status:'error',text:`Reference health check failed · ${e.message}`}));

    async function ensureReference(body){
      const key=String(body.productUrl||'').trim();
      if(!key||!enabledRef.current||!configuredRef.current)return null;
      if(cache.current.has(key))return cache.current.get(key);
      if(inflight.current.has(key))return inflight.current.get(key);
      const p=(async()=>{
        setSafe({status:'scanning',text:`Finding external references · ${body.productTitle||'product'}`});
        try{
          const r=await original('/api/reference-scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productUrl:key,productTitle:body.productTitle||'',productDescription:body.productDescription||''})});
          const j=await r.json();
          if(!r.ok)throw Error(j.error||'Reference scan failed');
          const profile=j.referenceProfile||null;
          cache.current.set(key,profile);
          if(profile?.usableReviews>0)setSafe({status:'ready',text:`Reference profile · ${profile.matchedPages||0} pages · ${profile.usableReviews} reviews · ${profile.confidence||'unknown'} confidence`});
          else setSafe({status:'ready',text:`Web matches found · ${profile?.matchedPages||0} pages · no extractable structured reviews`});
          return profile;
        }catch(e){
          cache.current.set(key,null);
          setSafe({status:'error',text:`Reference scan skipped · ${e.message}`});
          return null;
        }finally{inflight.current.delete(key)}
      })();
      inflight.current.set(key,p);return p;
    }

    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:(input instanceof URL?input.toString():input?.url||'');
      const isGenerate=/\/api\/generate(?:\?|$)/.test(url);
      if(!isGenerate||!enabledRef.current||!configuredRef.current)return original(input,init);
      try{
        const raw=init?.body;
        if(typeof raw!=='string')return original(input,init);
        const body=JSON.parse(raw),profile=await ensureReference(body);
        if(!profile?.usableReviews)return original(input,init);
        return original(input,{...init,body:JSON.stringify({...body,referenceProfile:profile})});
      }catch{return original(input,init)}
    };
    return()=>{alive=false;window.fetch=original};
  },[]);
  const border=info.status==='error'?'#6b3434':info.status==='ready'?'#31553c':'#3b4651';
  return <aside style={{maxWidth:1120,margin:'12px auto 0',padding:'10px 14px',border:`1px solid ${border}`,borderRadius:11,background:'#101820',display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,color:'#f4f6f8'}}><div style={{display:'flex',flexDirection:'column',gap:3}}><b style={{fontSize:12}}>External reference scan</b><span style={{fontSize:11,color:'#9aa6b2'}}>{info.text}</span></div><button style={{background:enabled?'#21402b':'#242b33',color:'#e2e6ea',border:'1px solid #3b4651',padding:'7px 10px'}} onClick={()=>setEnabled(!enabled)}>{enabled?'On':'Off'}</button></aside>
}

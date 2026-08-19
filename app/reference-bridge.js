'use client';
import{useEffect,useRef,useState}from'react';

const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

export default function ReferenceBridge(){
  const enabledRef=useRef(true),configuredRef=useRef(false),productsRef=useRef(new Map()),cacheRef=useRef(new Map()),originalRef=useRef(null),runsRef=useRef(new Map());
  const[enabled,setEnabledState]=useState(true),[products,setProducts]=useState([]),[active,setActive]=useState(''),[busy,setBusy]=useState(false),[info,setInfo]=useState({status:'checking',text:'Checking AI Gateway reference search…'}),[summary,setSummary]=useState(null);
  const setEnabled=v=>{enabledRef.current=v;setEnabledState(v)};
  const refreshProducts=()=>setProducts([...productsRef.current.values()]);
  const remember=p=>{if(!p?.productUrl||!p?.productTitle)return;productsRef.current.set(p.productUrl,{productUrl:p.productUrl,productTitle:p.productTitle,productDescription:p.productDescription||''});setActive(p.productUrl);refreshProducts()};
  const aggregateSummary=()=>{const sets=[...cacheRef.current.values()].filter(Boolean),map=new Map();let total=0,aggregateOnly=0;for(const s of sets){total+=Number(s.totalIndividualReviews)||0;aggregateOnly+=(s.aggregateOnlySources||[]).length;for(const x of s.platformCounts||[]){const k=`${x.platform}|${x.provider||''}`,v=map.get(k)||{...x,reviewCount:0,pageCount:0};v.reviewCount+=Number(x.reviewCount)||0;v.pageCount+=Number(x.pageCount)||0;map.set(k,v)}}return{total,aggregateOnly,platformCounts:[...map.values()].sort((a,b)=>b.reviewCount-a.reviewCount),products:sets.length}};
  async function scanOne(p){const original=originalRef.current||window.fetch.bind(window);const r=await original('/api/reference-scan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)}),j=await r.json();if(!r.ok)throw Error(j.error||'Reference scan failed');const set=j.referenceSet||null;if(set)cacheRef.current.set(p.productUrl,set);return set}
  async function scanReferences(all=false){const list=all?products:[productsRef.current.get(active)].filter(Boolean);if(!list.length)return;setBusy(true);setInfo({status:'scanning',text:`Scanning external references for ${list.length} product${list.length===1?'':'s'}…`});try{let cursor=0;async function worker(){while(true){const i=cursor++;if(i>=list.length)return;await scanOne(list[i])}}await Promise.all(Array.from({length:Math.min(2,list.length)},worker));const s=aggregateSummary();setSummary(s);setInfo({status:'ready',text:`Reference coverage ready · ${s.total.toLocaleString()} individual reviews across ${s.platformCounts.length} platform${s.platformCounts.length===1?'':'s'}`})}catch(e){setInfo({status:'error',text:`Reference scan failed · ${e.message}`})}finally{setBusy(false)}}
  useEffect(()=>{
    let alive=true;const original=window.fetch.bind(window);originalRef.current=original;
    original('/api/reference-health',{cache:'no-store'}).then(r=>r.json()).then(j=>{configuredRef.current=Boolean(j.configured);if(alive)setInfo(j.configured?{status:'ready',text:`Ready · ${j.provider||'AI Gateway reference search'} · scan before generation`}:{status:'missing',text:'Unavailable · AI Gateway authentication is not available in this deployment'})}).catch(e=>alive&&setInfo({status:'error',text:`Reference health check failed · ${e.message}`}));
    window.fetch=async(input,init)=>{
      const url=typeof input==='string'?input:(input instanceof URL?input.toString():input?.url||'');
      const isScan=/\/api\/scan(?:\?|$)/.test(url),isGenerate=/\/api\/generate(?:\?|$)/.test(url);
      if(isScan){const r=await original(input,init);try{const j=await r.clone().json();if(r.ok)remember(j)}catch{}return r}
      if(isGenerate){
        try{
          const raw=init?.body;if(typeof raw!=='string')return original(input,init);
          const body=JSON.parse(raw),productUrl=String(body.productUrl||''),runKey=`${productUrl}|${body.reviewCount}|${body.targetAverage}`;
          if(Number(body.offset)===0)runsRef.current.set(runKey,{seen:new Map(),lock:Promise.resolve()});
          if(!runsRef.current.has(runKey))runsRef.current.set(runKey,{seen:new Map(),lock:Promise.resolve()});
          const run=runsRef.current.get(runKey),set=cacheRef.current.get(productUrl),baseBody=enabledRef.current&&configuredRef.current&&set?.references?.length?{...body,referenceCards:set.references}:body;
          if(enabledRef.current&&configuredRef.current&&!set?.references?.length&&productsRef.current.has(productUrl))setInfo({status:'warning',text:`No external reference coverage scanned for ${body.productTitle||'this product'} · generation will be PDP-only unless you scan references first`});
          let release;const prev=run.lock;run.lock=new Promise(r=>{release=r});await prev;
          try{
            let response=null,json=null,attempt=0,avoid=[];
            while(attempt<3){attempt++;
              response=await original(input,{...init,body:JSON.stringify({...baseBody,avoidBodies:avoid,variationNonce:avoid.length?`${Date.now()}-${attempt}-${body.offset}`:undefined})});
              if(!response.ok)return response;
              try{json=await response.clone().json()}catch{return response}
              const collisions=[];for(const review of json.reviews||[]){const k=norm(review.body);if(k&&run.seen.has(k))collisions.push(run.seen.get(k))}
              if(!collisions.length){for(const review of json.reviews||[]){const k=norm(review.body);if(k)run.seen.set(k,review.body)}return response}
              avoid=[...new Set(collisions)].slice(0,12);
              setInfo({status:'warning',text:`Repairing ${collisions.length} cross-batch duplicate${collisions.length===1?'':'s'} before finalizing ${body.productTitle||'dataset'}…`});
            }
            return new Response(JSON.stringify({error:'Could not repair cross-batch duplicate bodies after 3 attempts.'}),{status:500,headers:{'content-type':'application/json'}})
          }finally{release()}
        }catch{return original(input,init)}
      }
      return original(input,init)
    };
    return()=>{alive=false;window.fetch=original};
  },[]);
  const current=cacheRef.current.get(active),shown=current?{total:current.totalIndividualReviews,platformCounts:current.platformCounts||[],aggregateOnly:(current.aggregateOnlySources||[]).length}:summary;
  const border=info.status==='error'?'#6b3434':info.status==='ready'?'#31553c':info.status==='warning'?'#70551f':'#3b4651';
  return <aside style={{maxWidth:1120,margin:'12px auto 0',padding:'12px 14px',border:`1px solid ${border}`,borderRadius:11,background:'#101820',display:'flex',flexDirection:'column',gap:10,color:'#f4f6f8'}}><div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12}}><div style={{display:'flex',flexDirection:'column',gap:3}}><b style={{fontSize:12}}>External reference coverage</b><span style={{fontSize:11,color:'#9aa6b2'}}>{info.text}</span></div><div style={{display:'flex',gap:8,alignItems:'center'}}>{products.length>0&&<button onClick={()=>scanReferences(false)} disabled={busy||!active} style={{background:'#273746',color:'#eef3f7',border:'1px solid #486176',padding:'7px 10px'}}>{busy?'Scanning…':'Scan references'}</button>}{products.length>1&&<button onClick={()=>scanReferences(true)} disabled={busy} style={{background:'#242b33',color:'#e2e6ea',border:'1px solid #3b4651',padding:'7px 10px'}}>Scan all {products.length}</button>}<button style={{background:enabled?'#21402b':'#242b33',color:'#e2e6ea',border:'1px solid #3b4651',padding:'7px 10px'}} onClick={()=>setEnabled(!enabled)}>{enabled?'On':'Off'}</button></div></div>{products.length>0&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>{products.length>1&&<select value={active} onChange={e=>setActive(e.target.value)} style={{maxWidth:360,background:'#151c23',color:'#e8edf2',border:'1px solid #394652',padding:'7px 9px',borderRadius:7}}>{products.map(p=><option key={p.productUrl} value={p.productUrl}>{p.productTitle}</option>)}</select>}{shown&&<><span style={{fontSize:11,padding:'6px 8px',border:'1px solid #31553c',borderRadius:8}}><b>{Number(shown.total||0).toLocaleString()}</b> individual references</span>{(shown.platformCounts||[]).slice(0,8).map(x=><span key={`${x.platform}-${x.provider||''}`} style={{fontSize:11,padding:'6px 8px',background:'#151c23',borderRadius:8}}><b>{x.reviewCount.toLocaleString()}</b> · {x.platform}{x.provider?` · ${x.provider}`:''}</span>)}{shown.aggregateOnly>0&&<span style={{fontSize:11,padding:'6px 8px',background:'#2a2418',borderRadius:8}}>Amazon/aggregate-only sources: <b>{shown.aggregateOnly}</b></span>}</>}</div>}{current&&<div style={{fontSize:11,color:'#9aa6b2'}}>Generation coverage: up to <b style={{color:'#e5ebef'}}>{Math.min(250,current.availableForGeneration||current.references?.length||0)}</b> fixtures can each use a different external review reference. Extra fixtures are PDP-only; references are never blended or recycled.</div>}</aside>
}

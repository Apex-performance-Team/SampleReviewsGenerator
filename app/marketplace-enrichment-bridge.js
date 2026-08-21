'use client';
import{useEffect}from'react';

export default function MarketplaceEnrichmentBridge(){
  useEffect(()=>{
    const baseFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const u=typeof input==='string'?input:(input instanceof URL?input.toString():input?.url||'');
      if(!/\/api\/reference-scan(?:\?|$)/.test(u))return baseFetch(input,init);
      const base=await baseFetch(input,init);
      if(!base.ok)return base;
      let payload;try{payload=await base.clone().json()}catch{return base}
      if(!payload?.referenceSet)return base;
      const market=[...(payload.referenceSet.sourceCounts||[]),...(payload.referenceSet.aggregateOnlySources||[])].some(x=>/(^|\.)(amazon|ebay)\./i.test((()=>{try{return new URL(x?.directSourceUrl||x?.sourceUrl||'').hostname}catch{return''}})()));
      if(!market)return base;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
      try{
        const r=await baseFetch('/api/reference-enrich-marketplaces',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({referenceSet:payload.referenceSet}),signal:controller.signal,cache:'no-store'});
        if(!r.ok)return base;
        const j=await r.json();if(!j?.referenceSet)return base;
        const original=Array.isArray(payload.referenceSet.references)?payload.referenceSet.references:[],enriched=Array.isArray(j.referenceSet.references)?j.referenceSet.references:[];
        if(enriched.length<original.length)return base;
        return new Response(JSON.stringify({...payload,referenceSet:j.referenceSet}),{status:base.status,headers:{'content-type':'application/json','cache-control':'no-store'}})
      }catch{return base}
      finally{clearTimeout(timer)}
    };
    return()=>{window.fetch=baseFetch};
  },[]);
  return null
}

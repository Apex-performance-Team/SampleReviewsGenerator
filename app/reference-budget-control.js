'use client';
import{useEffect,useState}from'react';

const MODES={
  test:{label:'Test',detail:'1 image · up to 3 Lens requests · 2 reference AI calls · 1 Amazon query · 20 Amazon/eBay reviews'},
  balanced:{label:'Balanced',detail:'2 images · up to 6 Lens requests · 8 reference AI calls · 3 Amazon queries · 50 Amazon/eBay reviews'},
  thorough:{label:'Thorough',detail:'4 images · up to 12 Lens requests · 10 reference AI calls · 4 Amazon queries · 50 Amazon/eBay reviews'}
};

export default function ReferenceBudgetControl(){
  const[mode,setMode]=useState('test');
  useEffect(()=>{const saved=window.localStorage.getItem('srl-reference-budget');if(MODES[saved])setMode(saved)},[]);
  const change=value=>{setMode(value);window.localStorage.setItem('srl-reference-budget',value);window.dispatchEvent(new CustomEvent('srl-reference-budget',{detail:value}))};
  return <section style={{maxWidth:1120,margin:'12px auto 0',padding:'10px 14px',border:'1px solid #3b4651',borderRadius:11,background:'#101820',display:'flex',alignItems:'center',justifyContent:'space-between',gap:14,color:'#f4f6f8',flexWrap:'wrap'}}><div style={{display:'flex',flexDirection:'column',gap:3}}><b style={{fontSize:12}}>Reference scan budget</b><span style={{fontSize:11,color:'#9aa6b2'}}>{MODES[mode].detail}. Whole-store discovery defers paid reference scans until generation or an explicit rescan.</span></div><select aria-label="Reference scan budget" value={mode} onChange={e=>change(e.target.value)} style={{background:'#151c23',color:'#e8edf2',border:'1px solid #486176',padding:'7px 9px',borderRadius:7}}>{Object.entries(MODES).map(([id,x])=><option key={id} value={id}>{x.label}</option>)}</select></section>
}

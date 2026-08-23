import{readFileSync,writeFileSync}from'node:fs';

const file='app/api/reference-scan-v11/route.js';
const from="async function html(x,t=16000){const u=url(x);if(!u)throw Error('invalid_public_url');const r=await fetch(u,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(t)}),h=await r.text(),finalUrl=String(r.url||u.href);if(r.status===403||r.status===429||/\\/blocked(?:[/?#]|$)|blocked\\?url=|captcha|robot check|robot or human|verify you are human|verify your identity|access denied|press and hold|hold button/i.test(`${finalUrl}\\n${h.slice(0,9000)}`))throw Error('blocked_or_challenged');if(!r.ok)throw Error(`http_${r.status}`);return{h,u:finalUrl}}";
const to="function challengePage(finalUrl,h){const head=String(h||'').slice(0,30000),visible=head.replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi,' ').replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi,' '),signal=String(finalUrl||'')+'\\n'+visible;return/\\/blocked(?:[/?#]|$)|blocked\\?url=/i.test(String(finalUrl||''))||/robot check|robot or human|verify you are human|verify your identity|access denied|press and hold|hold button/i.test(signal)||/<title[^>]*>\\s*(?:captcha|access denied|blocked|robot)/i.test(head)||/<(?:form|div)[^>]+(?:id|class)=[\"'][^\"']*(?:captcha|challenge-form|cf-challenge)[^\"']*/i.test(head)}\nasync function html(x,t=16000){const u=url(x);if(!u)throw Error('invalid_public_url');const r=await fetch(u,{headers:{'user-agent':UA,'accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(t)}),h=await r.text(),finalUrl=String(r.url||u.href);if(r.status===403||r.status===429||challengePage(finalUrl,h))throw Error('blocked_or_challenged');if(!r.ok)throw Error(`http_${r.status}`);return{h,u:finalUrl}}";

const before=readFileSync(file,'utf8');
if(before.includes(to)){
  console.log(`unchanged ${file}`);
  process.exit(0);
}
if(!before.includes(from))throw Error(`Patch anchor not found in ${file}`);
writeFileSync(file,before.replace(from,to));
console.log(`patched ${file}`);

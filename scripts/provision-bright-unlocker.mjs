const API='https://api.brightdata.com';
const ZONE_NAME='synthetic_review_ebay_items';
const key=process.env.BRIGHT_DATA_API_KEY||'';

if(!key)throw Error('BRIGHT_DATA_API_KEY is unavailable during the preview build.');

const headers={authorization:`Bearer ${key}`,'content-type':'application/json','accept':'application/json'};
const clean=value=>String(value||'').replace(/\s+/g,' ').trim().slice(0,240);
const unlocker=zone=>Boolean(zone?.name)&&/^(?:unblocker|web[_-]?unlocker)(?:[_-].*)?$/i.test(String(zone?.type||''));

async function activeZones(){
  const response=await fetch(`${API}/zone/get_active_zones`,{headers,signal:AbortSignal.timeout(15000)});
  const raw=await response.text();
  if(!response.ok)throw Error(`Bright Data active-zone lookup failed (${response.status}): ${clean(raw)}`);
  const zones=JSON.parse(raw);
  if(!Array.isArray(zones))throw Error('Bright Data returned an invalid active-zone response.');
  return zones;
}

const existing=(await activeZones()).find(unlocker);
if(existing){
  console.log('Bright Data Web Unlocker already active; no account change needed.');
}else{
  const response=await fetch(`${API}/zone`,{
    method:'POST',
    headers,
    body:JSON.stringify({zone:{name:ZONE_NAME,type:'unblocker'},plan:{type:'unblocker'}}),
    signal:AbortSignal.timeout(20000)
  });
  const raw=await response.text();
  if(!response.ok)throw Error(`Bright Data Web Unlocker creation failed (${response.status}): ${clean(raw)}`);
  const created=(await activeZones()).find(zone=>zone?.name===ZONE_NAME&&unlocker(zone));
  if(!created)throw Error('Bright Data accepted the request but the Web Unlocker did not become active.');
  console.log('Created and verified one Bright Data Web Unlocker for item-scoped eBay retrieval.');
}

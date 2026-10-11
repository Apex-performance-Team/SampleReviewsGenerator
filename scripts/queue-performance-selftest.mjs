import assert from 'node:assert/strict';
import {createQueuePoller} from '../lib/queue-poller.mjs';
import {checkRunStore,getRuns,listCatalogRuns} from '../lib/review-run-store.mjs';
import {catalogStatus} from '../lib/store-review-catalog.mjs';

// The queue must preserve progress while excluding arbitrarily large results.
process.env.SUPABASE_URL='https://database.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-key';
const full={id:'run-1',status:'completed',mode:'pdp_only',product_title:'Fixture',requested_count:6,completed_count:6,purged_count:0,input_json:{reviewCount:6},result_json:{reviews:[{body:'x'.repeat(1000000)}]}};
const requests=[];
globalThis.fetch=async(url,options)=>{
  assert.ok(options.signal, 'Database requests must have a deadline');
  const parsed=new URL(url),select=parsed.searchParams.get('select');
  requests.push(parsed);
  if(select==='id')return Response.json([{id:full.id}]);
  if(parsed.searchParams.has('input_json->>catalogRun')){
    assert.ok(!select.split(',').includes('result_json'), 'Catalog status must not load full results');
    return Response.json([{id:'catalog',status:'completed',requested_count:6,input_json:{catalogRun:true,childRunIds:[full.id]},workflow_run_id:'workflow-1',child_run_ids:[full.id]}]);
  }
  const projected=select==='*'?full:Object.fromEntries(select.split(',').filter(key=>key in full).map(key=>[key,full[key]]));
  return Response.json([projected]);
};
const [catalog]=await listCatalogRuns();
const summaries=await getRuns([full.id],{summaryOnly:true});
assert.deepEqual(catalogStatus(catalog,summaries).progress,catalogStatus(catalog,[full]).progress);
assert.equal(catalogStatus(catalog,summaries).catalog.workflowRunId,'workflow-1');
assert.deepEqual(summaries[0].result_json,{});
assert.ok(!requests.at(-1).searchParams.get('select').includes('input_json'));
assert.equal((await getRuns([full.id]))[0].result_json.reviews[0].body.length,1000000,'Result/export reads must remain complete');
assert.equal(await checkRunStore(),'supabase');
assert.equal(requests.at(-1).searchParams.get('select'),'id');
globalThis.fetch=async()=>new Response('unavailable',{status:503});
await assert.rejects(checkRunStore(),/503/,'Configured credentials alone must not report healthy storage');

// Deterministic clock: slow and failed requests must never overlap.
const timers=new Map();let timerId=0,calls=0,resolveTask,rejectTask,lastSignal;
const poller=createQueuePoller(signal=>{
  calls++;lastSignal=signal;
  return new Promise((resolve,reject)=>{
    resolveTask=resolve;rejectTask=reject;
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
  });
},{setTimer:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimer:id=>timers.delete(id)});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
poller.start();await tick();
const pending=poller.refresh();
assert.equal(pending,poller.refresh());
assert.equal(calls,1);
assert.deepEqual([...timers.values()].map(x=>x.ms),[20000],'Only the deadline may run while a request is pending');
resolveTask([{catalog:{status:'running'}}]);await pending;
assert.deepEqual([...timers.values()].map(x=>x.ms),[5000]);
const failed=poller.refresh();await tick();rejectTask(new Error('database timeout'));
await assert.rejects(failed,/database timeout/);
assert.deepEqual([...timers.values()].map(x=>x.ms),[10000]);
const failedAgain=poller.refresh();await tick();rejectTask(new Error('database timeout'));
await assert.rejects(failedAgain);
assert.deepEqual([...timers.values()].map(x=>x.ms),[20000]);
const recovered=poller.refresh();await tick();resolveTask([]);await recovered;
assert.deepEqual([...timers.values()].map(x=>x.ms),[30000],'Idle queues should poll slowly');
const stopped=poller.refresh();await tick();poller.stop();
assert.equal(lastSignal.aborted,true);
await assert.rejects(stopped);assert.equal(timers.size,0);
console.log('Queue performance checks passed: lean status reads, preserved exports, real health probe, single request, backoff, idle interval, cancellation.');

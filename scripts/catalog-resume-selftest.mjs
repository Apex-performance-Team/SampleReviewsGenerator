import assert from 'node:assert/strict';
import { createCatalogResumeHandler } from '../lib/resume-catalog-handler.mjs';
import { resumableChildren, resumeGuidance } from '../lib/catalog-resume.mjs';
import { catalogStatus } from '../lib/store-review-catalog.mjs';
import { advanceRun } from '../lib/review-run-engine.mjs';

const parentId = '11111111-1111-4111-8111-111111111111';
const failedId = '22222222-2222-4222-8222-222222222222';
const completeId = '33333333-3333-4333-8333-333333333333';
const failed = { id: failedId, status: 'failed', requested_count: 784, completed_count: 270, updated_at: '2026-11-12T23:06:11Z', error: 'AI Gateway 402: A positive credit balance is required.' };
const complete = { id: completeId, status: 'completed', requested_count: 100, completed_count: 100 };
const parent = { id: parentId, status: 'completed', input_json: { catalogRun: true, childRunIds: [completeId, failedId], bulk: true, concurrency: 8 } };
let records, active, starts;
function reset() { records = new Map([parent, failed, complete].map(row => [row.id, structuredClone(row)])); active = []; starts = []; }
const getRun = async id => { if (!records.has(id)) throw Error('Run not found.'); return structuredClone(records.get(id)); };
const getRuns = async ids => ids.filter(id => records.has(id)).map(id => structuredClone(records.get(id)));
const handler = createCatalogResumeHandler({
  getRun, getRuns, listCatalogRuns: async () => active,
  startCatalog: async req => { const body = await req.json(); starts.push(body); return Response.json({ started: true, catalogId: body.catalogId }, { status: 202 }); },
});
const resume = (id = parentId) => handler(new Request(`https://app.example.test/api/store-review-workflows/${id}/resume`, { method: 'POST' }), { params: Promise.resolve({ id }) });
reset();
const snapshot = catalogStatus(parent, [complete, failed]);
assert.deepEqual(resumableChildren(snapshot).map(row => row.id), [failedId]);
assert.match(resumeGuidance(snapshot), /Add AI Gateway credits/);
const [first, duplicate] = await Promise.all([resume(), resume()]);
assert.equal(first.status, 202); assert.equal(duplicate.status, 202);
assert.equal(starts[0].catalogId, starts[1].catalogId, 'Concurrent requests must reach the same atomic catalog claim');
assert.deepEqual(starts[0].resumeRunIds, [failedId], 'Completed products must never restart');
assert.equal(starts[0].concurrency, 8);
const firstId = starts[0].catalogId;
records.get(failedId).updated_at = '2026-11-13T00:30:00Z';
await resume();
assert.notEqual(starts.at(-1).catalogId, firstId, 'A later failure must be resumable again');

reset();
records.get(failedId).completed_count = 784;
assert.equal((await resume()).status, 202, 'A final QA failure at 100% must remain resumable');

reset();
active = [{ id: 'active-recovery', status: 'running', input_json: { catalogRun: true, childRunIds: [failedId] } }];
const existing = await (await resume()).json();
assert.equal(existing.catalogId, 'active-recovery'); assert.equal(existing.started, false); assert.equal(starts.length, 0);
assert.equal(resumableChildren(snapshot, [catalogStatus(active[0], [failed])]).length, 0, 'Old failed cards must not offer Resume during recovery');

reset();
await resume();
const bootstrapId = starts[0].catalogId;
records.set(bootstrapId, { id: bootstrapId, status: 'failed', updated_at: '2026-11-13T00:00:00Z' });
await resume();
assert.notEqual(starts.at(-1).catalogId, bootstrapId, 'A workflow launch failure must allow a new attempt');

for (const state of ['running', 'queued', 'canceled']) {
  reset(); records.get(parentId).status = state;
  assert.equal((await resume()).status, 409); assert.equal(starts.length, 0);
  assert.equal(resumableChildren({ ...snapshot, catalog: { ...snapshot.catalog, status: state } }).length, 0);
}
for (const state of ['completed', 'canceled', 'running']) {
  reset(); records.get(failedId).status = state;
  assert.equal((await resume()).status, 409); assert.equal(starts.length, 0);
}
reset(); assert.equal((await resume('invalid')).status, 400);
assert.equal((await resume('99999999-9999-4999-8999-999999999999')).status, 404);
records.get(parentId).input_json.catalogRun = false;
assert.equal((await resume()).status, 404);

// Exercise the real generation engine against an isolated fake API/store.
// It must start at the saved offset and preserve the previous review bodies and plan.
process.env.SUPABASE_URL = 'https://database.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
const originalReviews = Array.from({ length: 10 }, (_, index) => ({ id: `r${index}`, rating: 5, body: `Saved fixture ${index}` }));
let stored = { ...failed, requested_count: 20, completed_count: 10, mode: 'pdp_only', completed_at: '2026-11-12T23:06:11Z', input_json: { productTitle: 'Internal QA fixture', productDescription: 'Test context', targetAverage: 5 }, result_json: { reviews: originalReviews, plan: { planId: 'keep-plan', items: Array.from({ length: 20 }, (_, index) => ({ id: `r${index}`, rating: 5 })) } } };
let generationCalls = 0;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).startsWith(process.env.SUPABASE_URL)) {
    if (options.method === 'PATCH') stored = { ...stored, ...JSON.parse(options.body) };
    return Response.json([stored]);
  }
  assert.equal(url, 'https://app.example.test/api/generate');
  assert.equal(stored.error, null, 'Old billing errors must clear before work resumes');
  assert.equal(stored.completed_at, null);
  const payload = JSON.parse(options.body);
  assert.equal(payload.offset, 10); assert.equal(payload.planId, 'keep-plan');
  generationCalls++;
  return Response.json({ reviews: payload.planItems.map(item => ({ ...item, body: 'New internal QA fixture' })) });
};
const advanced = await advanceRun(failedId, 'https://app.example.test');
assert.equal(advanced.status, 'running'); assert.equal(advanced.completed_count, 20);
assert.deepEqual(advanced.result_json.reviews.slice(0, 10), originalReviews);
assert.equal(generationCalls, 1);
assert.equal(advanced.error, null);
console.log('Resume checks passed: partial/QA failures, saved checkpoint, repeat attempts, concurrent request IDs, active recovery reuse, terminal guards, and cleared stale errors.');

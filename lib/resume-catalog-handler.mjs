import { createHash } from 'node:crypto';
import { catalogStatus } from './store-review-catalog.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = { 'cache-control': 'no-store' };

function recoveryId(fingerprint) {
  const bytes = createHash('sha256').update(`catalog-resume:${fingerprint}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createCatalogResumeHandler({ getRun, getRuns, listCatalogRuns, startCatalog }) {
  return async function resume(req, { params }) {
    try {
      const { id } = await params;
      if (!UUID.test(id)) return Response.json({ error: 'A valid generation ID is required.' }, { status: 400, headers });
      const catalog = await getRun(id);
      if (!catalog.input_json?.catalogRun) return Response.json({ error: 'Catalog workflow not found.' }, { status: 404, headers });
      if (!['failed', 'completed'].includes(catalog.status))
        return Response.json({ error: 'Only stopped generations with failed work can be resumed.' }, { status: 409, headers });

      const childIds = catalog.input_json.childRunIds || catalog.result_json?.childRunIds || [];
      const children = await getRuns(childIds, { summaryOnly: true });
      // Check after reading children: a recovery owns its catalog before it advances any child.
      const active = await listCatalogRuns(50, { statuses: ['queued', 'running'] });
      const existing = active.find(run => (run.input_json?.childRunIds || run.result_json?.childRunIds || []).some(childId => childIds.includes(childId)));
      if (existing) {
        const currentChildren = await getRuns(existing.input_json?.childRunIds || existing.result_json?.childRunIds || [], { summaryOnly: true });
        return Response.json({ started: false, resumed: true, catalogId: existing.id, status: catalogStatus(existing, currentChildren) }, { status: 202, headers });
      }
      const failed = children.filter(child => child.status === 'failed');
      if (!failed.length)
        return Response.json({ error: 'No failed work remains to resume. Refresh the queue for its latest status.' }, { status: 409, headers });

      // Identical clicks (even in separate tabs or historical parent jobs) share one
      // catalog ID and the existing atomic queued-run claim. A new failure has a new timestamp.
      let fingerprint = failed.map(child => `${child.id}:${child.updated_at}`).sort().join('|');
      let catalogId;
      for (let attempt = 0; attempt < 20; attempt++) {
        catalogId = recoveryId(fingerprint);
        let previous;
        try { previous = await getRun(catalogId); }
        catch (error) { if (error.message !== 'Run not found.') throw error; }
        if (!previous || ['queued', 'running', 'completed'].includes(previous.status)) break;
        // A workflow can fail to start before it touches the child checkpoint.
        fingerprint += `|${previous.id}:${previous.updated_at}`;
        if (attempt === 19) throw Error('Could not allocate a recovery attempt. Please try again later.');
      }
      return await startCatalog(new Request(new URL('/api/store-review-workflows', req.url), {
        method: 'POST',
        headers: { ...Object.fromEntries(req.headers), 'content-type': 'application/json' },
        body: JSON.stringify({ catalogId, resumeRunIds: failed.map(child => child.id), concurrency: catalog.input_json.concurrency || 1, bulk: Boolean(catalog.input_json.bulk) }),
      }));
    } catch (error) {
      return Response.json({ error: error.message || 'Could not resume the generation.' }, { status: /not found/i.test(error.message) ? 404 : 500, headers });
    }
  };
}

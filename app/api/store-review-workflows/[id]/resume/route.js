import { POST as startCatalog } from '../../route.js';
import { getRun, getRuns, listCatalogRuns } from '../../../../../lib/review-run-store.mjs';
import { createCatalogResumeHandler } from '../../../../../lib/resume-catalog-handler.mjs';
import { publicRunRateLimit } from '../../../../../lib/public-run-rate-limit.mjs';

export const runtime = 'nodejs';
export const maxDuration = 180;

const resume = createCatalogResumeHandler({ getRun, getRuns, listCatalogRuns, startCatalog });

export async function POST(req, context) {
  const limited = publicRunRateLimit(req, { label: 'store-review-workflow-resume', limit: 20, windowMs: 15 * 60 * 1000 });
  return limited || resume(req, context);
}

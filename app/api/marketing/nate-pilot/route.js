import { createHash, timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
const requestAuth = new AsyncLocalStorage();
const STORE_RELAY = 'https://plcqypajqvtpnjctdlho.supabase.co/functions/v1/nate-pilot-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Single approved pilot. This is not a general proxy or a public scraping API.
// Only a hash of the temporary pilot capability is committed, never provider keys.
const TICKET_HASH = 'cad6e96f1a366c83e97ae5c5cf7b65c1c0fe2755e3a44d8fc996a56c70f84a28';
const EXPIRES_AT = Date.parse('2026-09-10T00:00:00Z');
const JOB = 'nate-google-2026-09-08-profile';
const PROFILE = 'https://x.com/Nate_Google_';
const DATASET = 'gd_lwxkxvnf1cynvib9co';
const MAX_RECORDS = 6000;
const BD = 'https://api.brightdata.com';
const noCache = {'cache-control':'private, no-store, max-age=0', 'pragma':'no-cache', 'x-robots-tag':'noindex, nofollow', 'referrer-policy':'no-referrer'};
const json = (value, status=200) => Response.json(value, {status, headers:noCache});
const datasetKey = () => process.env.BRIGHT_DATA_DATASET_API_KEY || process.env.BRIGHT_DATA_SCRAPER_API_KEY || process.env.BRIGHT_DATA_API_KEY || '';
const storageKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const storageUrl = () => (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const hash = value => createHash('sha256').update(String(value || '')).digest();
function authorized(req) {
  if (Date.now() >= EXPIRES_AT) return false;
  const ticket = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(req.url).searchParams.get('ticket') || '';
  return Boolean(ticket) && timingSafeEqual(hash(ticket), Buffer.from(TICKET_HASH, 'hex'));
}
function safeError(error) {
  let text = String(error?.message || error || 'unknown_error');
  for (const secret of [datasetKey(), storageKey()]) if (secret) text = text.split(secret).join('[REDACTED]');
  return text.slice(0, 1200);
}
async function request(url, options={}, timeout=20000) {
  const response = await fetch(url, {...options, cache:'no-store', signal:AbortSignal.timeout(timeout)});
  const raw = await response.text();
  let value; try { value = raw ? JSON.parse(raw) : null; } catch { value = {error:'non_json_response', detail:raw.slice(0, 1200)}; }
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}: ${JSON.stringify(value).slice(0, 1000)}`);
    error.status = response.status;
    throw error;
  }
  return value;
}
async function db(path, {method='GET', body, prefer='return=representation'}={}) {
  if (!storageUrl() || !storageKey()) {
    const token = requestAuth.getStore();
    if (!token) throw new Error('pilot_auth_missing');
    const op = path.startsWith('marketing_posts?') ? (method==='POST' ? 'save_posts' : 'sample') : method==='POST' ? 'insert_job' : method==='PATCH' ? 'update_job' : 'get_job';
    return request(STORE_RELAY,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({op,body})},30000);
  }
  return request(`${storageUrl()}/rest/v1/${path}`, {method, headers:{apikey:storageKey(), authorization:`Bearer ${storageKey()}`, 'content-type':'application/json', prefer}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}, 30000);
}
const jobQuery = `marketing_ingestion_jobs?job_key=eq.${JOB}`;
async function getJob() { return (await db(`${jobQuery}&select=*`))?.[0] || null; }
async function updateJob(patch) { return (await db(jobQuery, {method:'PATCH', body:{...patch, updated_at:new Date().toISOString()}}))?.[0] || null; }
async function bright(path, {method='GET', body, timeout=20000}={}) {
  if (!datasetKey()) throw new Error('bright_data_not_configured');
  return request(`${BD}${path}`, {method, headers:{authorization:`Bearer ${datasetKey()}`, 'content-type':'application/json', accept:'application/json'}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}, timeout);
}
function postId(value) {
  // Do not silently round X's 64-bit IDs when a provider sends unsafe JSON numbers.
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return null;
  const text = String(value ?? '');
  return /^\d{8,24}$/.test(text) ? text : null;
}
function normalize(row) {
  const url = typeof row?.url === 'string' ? row.url : null;
  const id = postId(row?.id) || postId(row?.post_id) || url?.match(/\/status\/(\d+)/)?.[1];
  if (!id) return null;
  const user = typeof row.user_posted === 'string' ? row.user_posted : url?.match(/(?:x|twitter)\.com\/([^/]+)\/status\//i)?.[1];
  const author = user?.replace(/^@/, '') || null;
  const date = row.date_posted || row.created_at;
  const published = date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
  const parent = postId(row.in_reply_to_status_id_str) || postId(row.in_reply_to_status_id) || postId(row.parent_post_id);
  const text = [row.full_text, row.description, row.text].filter(x=>typeof x==='string').sort((a,b)=>b.length-a.length)[0] || null;
  const articleUrls = [...new Set((JSON.stringify(row).match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/article|[^/\s"\\]+\/article)\/\d+/gi) || []))];
  return {id, source_job:JOB, author_handle:author, is_authored_by_target:author ? author.toLowerCase()==='nate_google_' : null,
    content_kind:parent && parent!==id ? 'reply' : row.quoted_post ? 'quote_post' : 'post', text, url, published_at:published,
    parent_post_id:parent && parent!==id ? parent : null, conversation_id:postId(row.conversation_id_str) || postId(row.conversation_id), article_urls:articleUrls, raw:row};
}
async function advance() {
  let job = await getJob();
  if (!job) {
    if (!datasetKey()) throw new Error('bright_data_not_configured');
    // Atomic insert is the spending guard: concurrent or repeated requests cannot start a second paid job.
    const inserted = await db('marketing_ingestion_jobs?on_conflict=job_key', {method:'POST', prefer:'resolution=ignore-duplicates,return=representation', body:{job_key:JOB, profile_url:PROFILE, dataset_id:DATASET, max_records:MAX_RECORDS, status:'starting'}});
    if (!inserted?.length) return {ok:true, job:await getJob(), note:'Existing job; no duplicate trigger.'};
    try {
      const params = new URLSearchParams({dataset_id:DATASET, type:'discover_new', discover_by:'profile_url', include_errors:'true', format:'json', limit_per_input:String(MAX_RECORDS), limit_multiple_results:String(MAX_RECORDS)});
      const result = await bright(`/datasets/v3/trigger?${params}`, {method:'POST', body:[{url:PROFILE}], timeout:25000});
      if (!/^sd_[a-zA-Z0-9_-]+$/.test(result?.snapshot_id || '')) throw new Error('No valid snapshot ID returned. Manual reconciliation required; do not re-trigger.');
      job = await updateJob({status:'collecting', snapshot_id:result.snapshot_id, progress:{phase:'provider_collection'}});
    } catch (error) {
      // Never automatically retry an ambiguous trigger timeout: it may already be billable upstream.
      await updateJob({status:error.status ? 'trigger_failed' : 'trigger_unknown', error:{message:safeError(error), httpStatus:error.status || null}});
      throw error;
    }
  }
  if (!job.snapshot_id || ['ingested','provider_failed'].includes(job.status)) return {ok:job.status==='ingested', job};
  const progress = await bright(`/datasets/v3/progress/${encodeURIComponent(job.snapshot_id)}`);
  const status = String(progress?.status || '').toLowerCase();
  if (status !== 'ready') {
    job = await updateJob({status:status==='failed' ? 'provider_failed' : 'collecting', progress});
    return {ok:status!=='failed', job};
  }
  const result = await bright(`/datasets/v3/snapshot/${encodeURIComponent(job.snapshot_id)}?format=json`, {timeout:60000});
  const rawRows = Array.isArray(result) ? result : Array.isArray(result?.data) ? result.data : Array.isArray(result?.results) ? result.results : null;
  if (!rawRows) throw new Error('Unexpected snapshot shape; raw snapshot retained at Bright Data; no fabricated rows.');
  const normalized = rawRows.map(normalize).filter(Boolean);
  const rows = [...new Map(normalized.map(row=>[row.id,row])).values()];
  for (let start=0; start<rows.length; start+=100) await db('marketing_posts?on_conflict=id', {method:'POST', prefer:'resolution=merge-duplicates,return=minimal', body:rows.slice(start,start+100)});
  const dates = rows.map(row=>row.published_at).filter(Boolean).sort();
  const summary = {phase:'ingested', rawRecords:rawRows.length, uniquePosts:rows.length, skippedRecords:rawRows.length-normalized.length,
    authoredByTarget:rows.filter(row=>row.is_authored_by_target===true).length, otherOrUnknownAuthors:rows.filter(row=>row.is_authored_by_target!==true).length,
    oldestPost:dates[0] || null, newestPost:dates.at(-1) || null, articleUrls:[...new Set(rows.flatMap(row=>row.article_urls))],
    sourceFields:[...new Set(rawRows.flatMap(row=>Object.keys(row || {})))], sampleErrors:rawRows.filter(row=>!normalize(row)).slice(0,10),
    fullHistoryVerified:false, fullArticleBodiesVerified:false};
  job = await updateJob({status:'ingested', progress:summary, error:null});
  return {ok:true, job};
}
async function handle(req) {
  if (!authorized(req)) return json({error:'not_found'},404);
  const op = new URL(req.url).searchParams.get('op') || 'status';
  try {
    if (op==='advance') return json(await advance());
    if (op==='sample') return json({rows:await db(`marketing_posts?source_job=eq.${JOB}&order=published_at.desc.nullslast&limit=3&select=*`)});
    if (op!=='status') return json({error:'unsupported_operation'},400);
    return json({profile:PROFILE, maxRecords:MAX_RECORDS, configured:{brightData:Boolean(datasetKey()), storage:true}, job:await getJob()});
  } catch (error) { return json({ok:false, error:safeError(error)},502); }
}
// POST is the preferred worker invocation. The temporary GET advance capability is
// scoped to this one idempotent, explicitly approved pilot for connector execution.
export async function GET(req) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || new URL(req.url).searchParams.get('ticket') || '';
  return requestAuth.run(token, () => handle(req));
}
export async function POST(req) { return GET(req); }

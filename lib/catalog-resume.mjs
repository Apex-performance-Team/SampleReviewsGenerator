export const activeCatalogStatuses = new Set(['queued', 'running']);

export function resumableChildren(run, runs = []) {
  if (!['failed', 'completed'].includes(run?.catalog?.status)) return [];
  const failed = (run.children || []).filter(child => child.status === 'failed');
  const ids = new Set(failed.map(child => child.id));
  const alreadyResuming = runs.some(other => activeCatalogStatuses.has(other.catalog?.status)
    && other.children?.some(child => ids.has(child.id)));
  return alreadyResuming ? [] : failed;
}

export function resumeGuidance(run) {
  const errors = [run.catalog?.error, ...(run.children || []).filter(child => child.status === 'failed').map(child => child.error)].join(' ');
  if (/\b402\b|credit balance|insufficient credits/i.test(errors))
    return 'Add AI Gateway credits, then resume. Saved progress will be kept.';
  return 'Resume from the last saved checkpoint. Completed work will be kept.';
}

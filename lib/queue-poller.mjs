// Manual refreshes and scheduled polls share one request. Schedule the next
// poll only after completion so a slow database cannot create a request storm.
export function createQueuePoller(task, {
  activeMs = 5000,
  idleMs = 30000,
  maxBackoffMs = 60000,
  timeoutMs = 20000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  let running = false, pending = null, timer = null, controller = null;
  let failures = 0, delay = activeMs;
  const clearScheduled = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  function refresh() {
    if (pending) return pending;
    clearScheduled();
    controller = new AbortController();
    const signal = controller.signal;
    const deadline = setTimer(() => controller?.abort(new Error('Queue request timed out.')), timeoutMs);
    pending = Promise.resolve().then(() => task(signal)).then((runs) => {
      failures = 0;
      delay = runs.some(run => ['queued', 'running'].includes(run.catalog?.status)) ? activeMs : idleMs;
      return runs;
    }).catch((error) => {
      failures += 1;
      delay = Math.min(maxBackoffMs, activeMs * 2 ** Math.min(failures, 6));
      throw error;
    }).finally(() => {
      clearTimer(deadline);
      pending = null;
      controller = null;
      if (running) timer = setTimer(() => { timer = null; refresh().catch(() => {}); }, delay);
    });
    return pending;
  }
  return {
    refresh,
    start() { running = true; refresh().catch(() => {}); },
    stop() { running = false; clearScheduled(); controller?.abort(); },
  };
}

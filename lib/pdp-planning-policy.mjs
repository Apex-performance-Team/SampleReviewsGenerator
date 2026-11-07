export const PDP_THEME_BATCH_SIZE=8;
export const PDP_PLANNING_STALL_LIMIT=6;
export const PDP_PLANNING_TIMEOUT_MS=75000;

export function planningErrorCode(error){
  if(/^PLANNER_/.test(error?.code||''))return error.code;
  const message=String(error?.message||error||'');
  if(/\b402\b|positive credit balance|insufficient (?:credits|funds)|billing/i.test(message))return 'PLANNER_BILLING';
  if(/\b401\b|\b403\b|credential|unauthorized|authentication/i.test(message))return 'PLANNER_AUTH';
  if(/timeout|timed out|aborted|deadline/i.test(message))return 'PLANNER_TIMEOUT';
  if(/\b429\b|rate.?limit|too many requests/i.test(message))return 'PLANNER_RATE_LIMIT';
  return 'PLANNER_OUTPUT';
}

export function planningErrorStatus(code){
  return code==='PLANNER_BILLING'?402:code==='PLANNER_AUTH'?401:code==='PLANNER_TIMEOUT'?504:code==='PLANNER_RATE_LIMIT'?429:502;
}

export function blockedPlanningError(message){
  const error=new Error(message);error.code='PLANNER_BLOCKED';return error;
}

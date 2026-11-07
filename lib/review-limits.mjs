export const PDP_REVIEW_LIMIT = 2000;
export const SOURCE_REVIEW_LIMIT = 250;
export const PDP_QA_CHUNK_SIZE = 50;
// Includes adaptive planning down to one theme with a bounded retry budget,
// 200 generation batches, four two-pass assessments,
// three full repair rounds, and transition/finalization checkpoints.
export const MAX_REVIEW_CHECKPOINTS = 2000;
export function reviewCountLimit(externalReferencesEnabled) {
  return externalReferencesEnabled ? SOURCE_REVIEW_LIMIT : PDP_REVIEW_LIMIT;
}

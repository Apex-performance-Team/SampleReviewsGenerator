import { reviewCountLimit } from './review-limits.mjs';

export function storeRangeError(minimum, maximum, externalReferencesEnabled = false) {
  const min = Number(minimum), max = Number(maximum), limit = reviewCountLimit(externalReferencesEnabled);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 5 || max < 5 || min > limit || max > limit)
    return `Minimum and maximum must be whole numbers from 5 to ${limit.toLocaleString()}.`;
  if (min > max) return 'Minimum reviews cannot exceed maximum reviews.';
  return '';
}

export function storeReviewCount(product, settings) {
  if (settings.mode !== 'range') return Number(product.reviewCount ?? settings.fixedCount);
  if (storeRangeError(settings.min, settings.max, settings.externalReferencesEnabled)) return null;
  // A custom range-mode count belongs only to this product. Keep it when the
  // range changes; null/undefined restores the product's stable range sample.
  if (product.reviewCountOverride != null) return Number(product.reviewCountOverride);
  const sample = product.reviewCountSample;
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) return null;
  const min = Number(settings.min), max = Number(settings.max);
  // The sample is assigned once when a product is discovered. Rendering,
  // filtering, selection, and queue retries must never reroll its count.
  return min + Math.floor(sample * (max - min + 1));
}

export function prepareStoreBatch(products, settings) {
  if (settings.mode === 'range') {
    const error = storeRangeError(settings.min, settings.max, settings.externalReferencesEnabled);
    if (error) throw Error(error);
  }
  const selected = products.filter(product => product.enabled && product.status === 'done');
  if (!selected.length) throw Error('Select at least one successfully scanned product.');
  const limit = reviewCountLimit(settings.externalReferencesEnabled);
  const selectedWithCounts = selected.map(product => {
    const count = storeReviewCount(product, settings);
    if (!Number.isInteger(count) || count < 5 || count > limit)
      throw Error(`Review count for ${product.productTitle || product.title || 'one product'} must be 5–${limit}.`);
    return { ...product, requestedReviewCount: count };
  });
  return { products: selectedWithCounts, total: selectedWithCounts.reduce((sum, product) => sum + product.requestedReviewCount, 0) };
}

import assert from 'node:assert/strict';
import { prepareStoreBatch, storeRangeError, storeReviewCount } from '../lib/store-review-counts.mjs';

const range = { mode: 'range', min: 100, max: 200, fixedCount: 80, externalReferencesEnabled: false };
const products = [0, 0.5, 0.999999].map((sample, index) => ({ index, title: `Fixture ${index}`, enabled: true, status: 'done', reviewCountSample: sample, reviewCount: 70 + index }));
const batch = prepareStoreBatch(products, range);
assert.deepEqual(batch.products.map(product => product.requestedReviewCount), [100, 150, 200]);
assert.equal(batch.total, 450, 'Queue totals must match the assigned counts');
assert.deepEqual(products.map(product => storeReviewCount(product, range)), batch.products.map(product => product.requestedReviewCount), 'Preview and queued counts must match exactly');
assert.deepEqual(prepareStoreBatch(products, range), batch, 'Renders and retries must never reroll counts');
assert.deepEqual(products.map(product => product.reviewCount), [70, 71, 72], 'Range mode must preserve fixed-count overrides');
assert.deepEqual(prepareStoreBatch(products, { ...range, mode: 'fixed' }).products.map(product => product.requestedReviewCount), [70, 71, 72]);
assert.equal(storeReviewCount({ reviewCount: '115' }, { ...range, mode: 'fixed' }), 115);
assert.equal(storeReviewCount({}, { ...range, mode: 'fixed' }), 80);

const selected = products.map((product, index) => ({ ...product, enabled: index !== 1 }));
assert.equal(prepareStoreBatch(selected, range).total, 300);
const reordered = prepareStoreBatch([...products].reverse(), range);
assert.deepEqual(reordered.products.map(product => product.requestedReviewCount), [200, 150, 100]);
assert.equal(prepareStoreBatch([...products, { ...products[0], status: 'error' }, { ...products[0], status: 'scanning' }], range).total, 450);
assert.throws(() => prepareStoreBatch(products.map(product => ({ ...product, enabled: false })), range), /Select at least/);

const updated = { ...range, min: 300, max: 500 };
assert.deepEqual(prepareStoreBatch(products, updated).products.map(product => product.requestedReviewCount), [300, 400, 500]);
assert.deepEqual(prepareStoreBatch(products, range), batch, 'Returning to a range must restore the same assigned counts');
for (const count of [5, 250, 2000]) {
  assert.deepEqual(prepareStoreBatch(products, { ...range, min: count, max: count }).products.map(product => product.requestedReviewCount), [count, count, count]);
}
for (const [min, max] of [['', 100], [5, ''], [4, 100], [5, 2001], [200, 100], [5.5, 100], [5, 100.1], [NaN, 100], [5, Infinity]]) {
  assert.notEqual(storeRangeError(min, max), '');
  assert.equal(storeReviewCount(products[0], { ...range, min, max }), null);
  assert.throws(() => prepareStoreBatch(products, { ...range, min, max }));
}
assert.equal(storeRangeError(5, 250, true), '');
assert.match(storeRangeError(5, 251, true), /250/);
assert.throws(() => prepareStoreBatch(products, { ...range, min: 100, max: 500, externalReferencesEnabled: true }), /250/);
assert.equal(storeRangeError(5, 2000, false), '');
for (const sample of [undefined, NaN, -0.01, 1]) {
  assert.equal(storeReviewCount({ ...products[0], reviewCountSample: sample }, range), null);
}
assert.throws(() => prepareStoreBatch([{ ...products[0], reviewCountSample: undefined }], range), /Review count/);

// Every supported sample must yield a whole-number count inside the inclusive bounds.
for (let i = 0; i < 1000; i++) {
  const count = storeReviewCount({ reviewCountSample: i / 1000 }, { ...range, min: 5, max: 2000 });
  assert.ok(Number.isInteger(count) && count >= 5 && count <= 2000);
}
// The durable request carries concrete counts, so resume cannot pick a new target.
const payload = { products: batch.products.map(product => ({ reviewCount: product.requestedReviewCount })) };
assert.deepEqual(JSON.parse(JSON.stringify(payload)).products.map(product => product.reviewCount), [100, 150, 200]);
console.log('Store range checks passed: inclusive bounds, stable preview/queue counts, exact totals, selection/order independence, fixed overrides, validation, and reference-mode limits.');

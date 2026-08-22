import assert from'node:assert/strict';
import{amazonReviewRows,amazonReviewsToCsv,csvCell}from'../lib/amazon-review-csv.mjs';

const source={platform:'amazon.com',asin:'B0CKYX98FX',directSourceUrl:'https://www.amazon.com/dp/B0CKYX98FX'};
const result={canonicalUrl:source.directSourceUrl,attempted:1,batches:[{snapshotId:'snap_test'}]};
const reviews=[
  {reviewId:'R1',authorName:'A. Buyer',verifiedPurchase:true,reviewDate:'2026-08-01',rating:5,title:'Works, well',body:'Strong reception and easy setup.'},
  {reviewId:'R2',authorName:'B "Quoted" Buyer',verifiedPurchase:false,reviewDate:'2026-08-02',rating:4,title:'Good',body:'The body contains a "quoted" phrase.'}
];
const control={maxReviews:50,maxBatches:1};
const balance={before:19.5,after:19.45,delta:.05,pendingBefore:0,pendingAfter:0};
const rows=amazonReviewRows({reviews,source,result,control,balance});
const csv=amazonReviewsToCsv({reviews,source,result,control,balance});

assert.equal(rows.length,2);
assert.equal(rows[0].probe_requested_reviews,50);
assert.equal(rows[0].probe_max_batches,1);
assert.equal(rows[0].bright_data_trigger_count,1);
assert.equal(rows[0].bright_data_snapshot_id,'snap_test');
assert.equal(csvCell('a"b'),'"a""b"');
assert.ok(csv.startsWith('\ufeff"export_index"'));
assert.ok(csv.includes('"Works, well"'));
assert.ok(csv.includes('"B ""Quoted"" Buyer"'));
assert.ok(csv.includes('"The body contains a ""quoted"" phrase."'));
console.log(JSON.stringify({ok:true,rows:rows.length,requested:rows[0].probe_requested_reviews,maxBatches:rows[0].probe_max_batches}));

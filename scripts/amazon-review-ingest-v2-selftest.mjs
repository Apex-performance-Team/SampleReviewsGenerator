import assert from'node:assert/strict';
import{collectAmazonReviewsV2}from'../lib/amazon-review-ingest-v2.js';

const source={directSourceUrl:'https://www.amazon.com/dp/B012345678',title:'Outdoor Omni TV Antenna'};
const row=(id,body,extra={})=>({review_id:id,review_text:body,rating:5,product_name:'Outdoor Omni TV Antenna',...extra});

{
  const inputs=[];
  const snapshotFn=async input=>{
    inputs.push(input);
    if(input.variation_specific)return{ok:true,data:[row('', 'Exact variant review body one.'),row('', 'Exact variant review body two.')]};
    return{ok:true,data:[row('', 'Family review body three.'),row('', 'Family review body four.'),row('', 'Family review body five.')]};
  };
  const result=await collectAmazonReviewsV2(source,{maxReviews:5,maxBatches:3,productTitle:'Outdoor Omni TV Antenna',snapshotFn});
  assert.equal(result.reviews.length,5);
  assert.deepEqual(inputs.map(input=>input.variation_specific),[true,false]);
  assert.deepEqual(result.batches.map(batch=>batch.lane),['exact_variant','listing_family']);
  assert.equal(result.batches[0].newBodies,2);
  assert.equal(result.batches[0].newReviewIds,0);
}

{
  const inputs=[];
  const pages=[
    [row('R111111111','First ID-backed review body.'),row('R222222222','Second ID-backed review body.')],
    [row('R333333333','Third ID-backed review body.')],
  ];
  const snapshotFn=async input=>{inputs.push(input);return{ok:true,data:pages.shift()||[]}};
  const result=await collectAmazonReviewsV2(source,{maxReviews:3,maxBatches:3,productTitle:'Outdoor Omni TV Antenna',snapshotFn});
  assert.equal(result.reviews.length,3);
  assert.deepEqual(inputs.map(input=>input.variation_specific),[true,true]);
  assert.deepEqual(inputs[1].reviews_to_not_include.sort(),['R111111111','R222222222']);
  assert.equal(result.parsedReviewIds,3);
}

{
  const existing='Previously exported exact review body.';
  const inputs=[];
  const snapshotFn=async input=>{
    inputs.push(input);
    if(input.variation_specific)return{ok:true,data:[row('',existing)]};
    return{ok:true,data:[
      row('R444444444','I mounted this outdoor antenna on the roof.',{variation:'Outdoor Omni Antenna'}),
      row('R555555555','The flat antenna taped neatly to my living-room window.',{variation:'Indoor Flat Antenna'}),
    ]};
  };
  const result=await collectAmazonReviewsV2(source,{maxReviews:2,maxBatches:3,excludeReviewBodies:[existing],productTitle:'Outdoor Omni TV Antenna',snapshotFn});
  assert.equal(result.reviews.length,1);
  assert.equal(result.reviews[0].reviewId,'R444444444');
  assert.equal(result.titleCompatibilityFilter.rejectedCount,1);
  assert.deepEqual(inputs.map(input=>input.variation_specific),[true,false,false]);
}

console.log('Amazon review pagination, family fallback, exclusion, and title-filter self-tests passed');

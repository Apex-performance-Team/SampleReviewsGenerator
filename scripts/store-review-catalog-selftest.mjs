import assert from 'node:assert/strict';

import {buildCatalogResult,catalogStatus,compactReviewRun} from '../lib/store-review-catalog.mjs';

const catalog={id:'catalog-id',status:'completed',mode:'pdp_only',requested_count:10,completed_count:7,purged_count:1,current_step:'completed_with_errors',progress_message:'Finished with 1 failed SKU.',error:'Second product: failed',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:01:00.000Z',input_json:{catalogRun:true,targetAverage:4.7},result_json:{workflowRunId:'workflow-id'}};
const children=[
  {id:'run-1',status:'completed',mode:'pdp_only',product_title:'First product',product_url:'https://example.com/first',requested_count:5,completed_count:5,purged_count:0,current_step:'completed',progress_message:'Completed.',error:null,updated_at:'2026-01-01T00:01:00.000Z',input_json:{productTitle:'First product',productUrl:'https://example.com/first',reviewCount:5,targetAverage:4.7},result_json:{finalResult:{reviews:[{id:'1'},{id:'2'},{id:'3'},{id:'4'},{id:'5'}],purgedReviews:[],purgedReviewCount:0}}},
  {id:'run-2',status:'failed',mode:'pdp_only',product_title:'Second product',product_url:'https://example.com/second',requested_count:5,completed_count:2,purged_count:1,current_step:'failed',progress_message:'Failed.',error:'AI provider unavailable',updated_at:'2026-01-01T00:01:00.000Z',input_json:{productTitle:'Second product',productUrl:'https://example.com/second',reviewCount:5,targetAverage:4.7},result_json:{reviews:[{id:'6'},{id:'7'}],purgedReviews:[{id:'8'}]}},
];

const status=catalogStatus(catalog,children,'completed');
assert.deepEqual(status.progress,{done:7,total:10,percent:70,completeSkus:1,failedSkus:1,totalSkus:2});
assert.equal(status.catalog.workflowRunId,'workflow-id');
assert.equal(compactReviewRun(children[0]).completedCount,5);

const result=buildCatalogResult(catalog,children);
assert.equal(result.skuCount,2);
assert.equal(result.generatedReviewCount,10);
assert.equal(result.totalReviews,7);
assert.equal(result.totalPurgedReviews,1);
assert.equal(result.products[1].runStatus,'failed');
assert.equal(result.products[1].reviews.length,2);

console.log(JSON.stringify({ok:true,progress:status.progress,totalReviews:result.totalReviews}));

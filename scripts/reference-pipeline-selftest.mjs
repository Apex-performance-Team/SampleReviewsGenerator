import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{candidateFamily,candidateHost,interleaveReferencesBySource,referenceBudget,selectDiverseCandidates,selectRetailerDiverseCandidates,uniqueReferences}from'../lib/reference-pipeline.mjs';
import{assessLocalLensCandidate}from'../lib/lens-verification.mjs';
import{repairGeneratedCorpus,runPool}from'../lib/generation-coordinator.mjs';
import{sourceCardCounts}from'../lib/source-card-counts.mjs';

const test=referenceBudget('test'),balanced=referenceBudget('balanced'),thorough=referenceBudget('thorough');
assert.deepEqual([test.maxImages,test.maxAmazonQueries,test.maxMarketplaceReviews],[3,4,20]);
assert.equal(test.maxAmazonPages,2);
assert.deepEqual([test.maxCandidates,test.maxSources],[24,20]);
assert.deepEqual([test.maxReferenceAiCalls,test.useAiCountEnrichment,test.useAiAmazonQueries,test.useAiAmazonWebFallback],[7,true,true,false]);
assert.deepEqual([balanced.maxReferenceAiCalls,thorough.maxReferenceAiCalls],[8,10]);
assert.deepEqual([balanced.maxImages,balanced.maxAmazonQueries,balanced.maxMarketplaceReviews],[3,4,200]);
assert.deepEqual([thorough.maxImages,thorough.maxAmazonQueries,thorough.maxMarketplaceReviews],[4,4,200]);
assert.equal(referenceBudget('unexpected').id,'test');

assert.deepEqual(sourceCardCounts({publicReviewCount:1150,individualExtractedCount:3}),{extracted:3,listed:1150,headline:1150,sortCount:1150});
assert.deepEqual(sourceCardCounts({publicReviewCount:null,extractedReviewCount:5}),{extracted:5,listed:null,headline:5,sortCount:5});
assert.deepEqual(sourceCardCounts({aggregateRatingCount:407,reviewCount:5}),{extracted:5,listed:407,headline:407,sortCount:407});

const rows=[
  ...Array.from({length:8},(_,i)=>({u:`https://www.amazon.com/dp/B00000000${i}`,score:.96,rank:i+1,imageHits:1})),
  {u:'https://www.walmart.com/ip/same-product',score:.84,rank:1,imageHits:2},
  {u:'https://www.ebay.com/itm/same-product',score:.84,rank:2,imageHits:1},
  {u:'https://retailer.example/products/same-product',score:.62,rank:1,imageHits:3}
];
const selected=selectDiverseCandidates(rows,{limit:6,maxPerHost:3}),hosts=selected.map(candidateHost);
assert.equal(selected.length,6);
assert.deepEqual(hosts.slice(0,4),['amazon.com','walmart.com','ebay.com','retailer.example']);
assert.ok(hosts.filter(x=>x==='amazon.com').length<=3);

const volumeRanked=selectDiverseCandidates([
  {u:'https://www.amazon.com/dp/B000000001',score:.96,rank:2,publicCount:12},
  {u:'https://www.amazon.com/dp/B000000002',score:.96,rank:2,publicCount:1148}
],{limit:2,maxPerHost:2});
assert.equal(volumeRanked[0].publicCount,1148);

const retailerSelected=selectRetailerDiverseCandidates([
  {u:'https://www.amazon.com/dp/B000000001',score:.96},
  {u:'https://www.amazon.ca/dp/B000000002',score:.95},
  {u:'https://www.walmart.com/ip/same-product',score:.9},
  {u:'https://www.ebay.com/itm/same-product',score:.89},
  {u:'https://retailer.example/products/same-product',score:.88}
],{limit:5,maxPerHost:4,maxPerFamily:4});
assert.deepEqual(retailerSelected.slice(0,4).map(candidateFamily),['amazon','walmart','ebay','retailer.example']);

const interleaved=interleaveReferencesBySource([
  {referenceId:'a1',platform:'amazon.com',sourceUrl:'https://amazon.com/dp/a',sourceBody:'Amazon one'},
  {referenceId:'a2',platform:'amazon.com',sourceUrl:'https://amazon.com/dp/a',sourceBody:'Amazon two'},
  {referenceId:'w1',platform:'walmart.com',sourceUrl:'https://walmart.com/ip/w',sourceBody:'Walmart one'},
  {referenceId:'w2',platform:'walmart.com',sourceUrl:'https://walmart.com/ip/w',sourceBody:'Walmart two'}
]);
assert.deepEqual(interleaved.map(x=>x.referenceId),['a1','w1','a2','w2']);

const localAccepted=assessLocalLensCandidate({tabs:['products'],title:'InstaBeam Premium Indoor HDTV Antenna'},{ok:true,score:.9,differenceHash:.85,silhouetteIou:.8},'InstaBeam Premium Indoor HDTV Antenna indoor television antenna');
assert.equal(localAccepted.accepted,true);
const localRejected=assessLocalLensCandidate({tabs:['visual_matches'],title:'Generic television accessory'},{ok:true,score:.83,differenceHash:.76,silhouetteIou:.65},'InstaBeam Premium Indoor HDTV Antenna');
assert.equal(localRejected.accepted,false);

const refs=uniqueReferences([
  {referenceId:'1',sourceBody:'Works very well.'},
  {referenceId:'2',sourceBody:'Works VERY well!!!'},
  {referenceId:'3',sourceBody:'Setup took about five minutes.'}
]);
assert.deepEqual(refs.map(x=>x.referenceId),['1','3']);

let activeWorkers=0,maxActiveWorkers=0;
const pooled=await runPool(Array.from({length:10},(_,i)=>i),8,async i=>{activeWorkers++;maxActiveWorkers=Math.max(maxActiveWorkers,activeWorkers);await new Promise(r=>setTimeout(r,2));activeWorkers--;return i*2});
assert.deepEqual(pooled,Array.from({length:10},(_,i)=>i*2));
assert.equal(maxActiveWorkers,8);

let qaCalls=0;
const repaired=await repairGeneratedCorpus({reviews:[{id:'1',body:'same'},{id:'2',body:'same'}],requestRepair:async current=>{qaCalls++;return{reviews:current.map((x,i)=>i?{...x,body:'different'}:x),repairCount:1,diagnostics:{exactDuplicateGroups:[]},model:'test'}}});
assert.equal(qaCalls,1);
assert.deepEqual(repaired.reviews.map(x=>x.body),['same','different']);

const transport=await readFile(new URL('../lib/bright-lens-native.js',import.meta.url),'utf8'),layout=await readFile(new URL('../app/layout.js',import.meta.url),'utf8'),page=await readFile(new URL('../app/page.js',import.meta.url),'utf8'),bridge=await readFile(new URL('../app/reference-bridge.js',import.meta.url),'utf8'),budgetControl=await readFile(new URL('../app/reference-budget-control.js',import.meta.url),'utf8'),diagnosticUi=await readFile(new URL('../app/reference-scan-diagnostics.js',import.meta.url),'utf8'),wrapper=await readFile(new URL('../app/api/reference-scan/route.js',import.meta.url),'utf8'),lensRoute=await readFile(new URL('../app/api/reference-scan-v11/route.js',import.meta.url),'utf8'),lensFallback=await readFile(new URL('../app/api/reference-scan-v12/route.js',import.meta.url),'utf8'),amazonDiscovery=await readFile(new URL('../lib/amazon-volume-discovery-v2.js',import.meta.url),'utf8');
assert.match(transport,/x-unblock-data-format'\s*:\s*'parsed_light'/);
assert.match(transport,/headers=\{'x-brd-session':upload\.session,'x-unblock-data-format':'parsed_light'\}/);
assert.doesNotMatch(layout,/MarketplaceEnrichmentBridge/);
assert.match(lensRoute,/resize\(512,512/);
assert.match(amazonDiscovery,/resize\(512,512/);
assert.match(lensRoute,/rejectedCandidates:rejectedCandidateDiagnostics/);
assert.match(lensRoute,/assessLocalLensCandidate/);
assert.match(lensRoute,/selectRetailerDiverseCandidates/);
assert.match(lensRoute,/maxPerHost:8,maxPerFamily:8/);
assert.doesNotMatch(lensRoute,/diag\.stoppedEarly=true/);
assert.match(lensRoute,/interleaveReferencesBySource/);
assert.match(amazonDiscovery,/candidateEvaluations/);
assert.match(lensFallback,/deterministicRescueAssessments/);
assert.match(wrapper,/\[reference-scan-empty\]/);
assert.match(wrapper,/function providerStatus/);
assert.match(bridge,/ReferenceScanDiagnostics/);
assert.match(bridge,/error\.diagnostics=json\?\.diagnostics/);
assert.match(bridge,/x\.estimate!=null/);
assert.match(bridge,/public reviews on listing/);
assert.match(bridge,/b\.sortCount-a\.sortCount/);
assert.match(bridge,/enrichMarketplaceReferences/);
assert.match(bridge,/maxMarketplaceReviews:step/);
assert.match(bridge,/pass<=10/);
assert.doesNotMatch(bridge,/run\.parts\.size>=run\.expected/);
assert.match(diagnosticUi,/Rejected Lens candidates/);
assert.match(diagnosticUi,/viewing this saved diagnostic uses no provider credits/);
assert.match(page,/20 reviews in Test or 200 in Balanced\/Thorough/);
assert.match(budgetControl,/3 images · 9 Lens requests · up to 7 reference AI calls · 4 Amazon queries/);
assert.match(amazonDiscovery,/ai_plus_deterministic/);
assert.match(amazonDiscovery,/existingAsins/);
assert.match(amazonDiscovery,/Number\(x\.ratingCount\)<=0/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/targetSourceCount-existingAsins\.size-candidateAsins\.size/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/related_category_fallback/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/MAX_MARKETPLACE_PULLS=250/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/maxDuration=1800/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/amazonBatchLimit\(budget\)/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/strategy:'sequential_highest_volume_fill'/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/fillRemaining=marketplaceLimit/);
assert.doesNotMatch(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/Promise\.all\(jobs/);
assert.match(await readFile(new URL('../lib/amazon-review-ingest-v2.js',import.meta.url),'utf8'),/perBatchReviews=Math\.min\(50,requested\)/);
assert.match(await readFile(new URL('../lib/amazon-review-ingest-v2.js',import.meta.url),'utf8'),/max_reviews:batchReviews/);
assert.match(await readFile(new URL('../lib/amazon-review-ingest-v2.js',import.meta.url),'utf8'),/excludeReviewIds=\[\]/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/existingReviewIdsForSource/);
assert.match(await readFile(new URL('../app/api/reference-enrich-marketplaces/route.js',import.meta.url),'utf8'),/excludedReviewIds/);
assert.match(page,/\/api\/generation-plan/);
assert.match(page,/runQualityPipeline/);
assert.match(page,/corpusQualitySignals/);
assert.match(page,/syntheticReviewCsv/);
assert.match(page,/syntheticReviewBulkCsv/);

console.log(JSON.stringify({ok:true,budgets:{test,balanced,thorough},diverseHosts:hosts,retailerFamilies:retailerSelected.map(candidateFamily),uniqueReferenceCount:refs.length,maxActiveWorkers},null,2));

import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{candidateFamily,candidateHost,interleaveReferencesBySource,referenceBudget,selectDiverseCandidates,selectRetailerDiverseCandidates,uniqueReferences}from'../lib/reference-pipeline.mjs';
import{assessLocalLensCandidate}from'../lib/lens-verification.mjs';
import{repairGeneratedCorpus,runPool}from'../lib/generation-coordinator.mjs';

const test=referenceBudget('test'),balanced=referenceBudget('balanced'),thorough=referenceBudget('thorough');
assert.deepEqual([test.maxImages,test.maxAmazonQueries,test.maxMarketplaceReviews],[1,1,20]);
assert.equal(test.maxCandidates,6);
assert.deepEqual([test.maxReferenceAiCalls,test.useAiCountEnrichment,test.useAiAmazonQueries,test.useAiAmazonWebFallback],[2,false,false,false]);
assert.deepEqual([balanced.maxReferenceAiCalls,thorough.maxReferenceAiCalls],[8,10]);
assert.deepEqual([balanced.maxImages,balanced.maxAmazonQueries,balanced.maxMarketplaceReviews],[2,3,50]);
assert.deepEqual([thorough.maxImages,thorough.maxAmazonQueries,thorough.maxMarketplaceReviews],[4,4,50]);
assert.equal(referenceBudget('unexpected').id,'test');

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

const transport=await readFile(new URL('../lib/bright-lens-native.js',import.meta.url),'utf8'),layout=await readFile(new URL('../app/layout.js',import.meta.url),'utf8'),page=await readFile(new URL('../app/page.js',import.meta.url),'utf8'),bridge=await readFile(new URL('../app/reference-bridge.js',import.meta.url),'utf8'),diagnosticUi=await readFile(new URL('../app/reference-scan-diagnostics.js',import.meta.url),'utf8'),wrapper=await readFile(new URL('../app/api/reference-scan/route.js',import.meta.url),'utf8'),lensRoute=await readFile(new URL('../app/api/reference-scan-v11/route.js',import.meta.url),'utf8'),lensFallback=await readFile(new URL('../app/api/reference-scan-v12/route.js',import.meta.url),'utf8'),amazonDiscovery=await readFile(new URL('../lib/amazon-volume-discovery-v2.js',import.meta.url),'utf8');
assert.match(transport,/x-unblock-data-format'\s*:\s*'parsed_light'/);
assert.match(transport,/headers=\{'x-brd-session':upload\.session,'x-unblock-data-format':'parsed_light'\}/);
assert.doesNotMatch(layout,/MarketplaceEnrichmentBridge/);
assert.match(lensRoute,/resize\(512,512/);
assert.match(amazonDiscovery,/resize\(512,512/);
assert.match(lensRoute,/rejectedCandidates:rejectedCandidateDiagnostics/);
assert.match(lensRoute,/assessLocalLensCandidate/);
assert.match(lensRoute,/selectRetailerDiverseCandidates/);
assert.match(lensRoute,/interleaveReferencesBySource/);
assert.match(amazonDiscovery,/candidateEvaluations/);
assert.match(lensFallback,/deterministicRescueAssessments/);
assert.match(wrapper,/\[reference-scan-empty\]/);
assert.match(wrapper,/function providerStatus/);
assert.match(bridge,/ReferenceScanDiagnostics/);
assert.match(bridge,/error\.diagnostics=json\?\.diagnostics/);
assert.doesNotMatch(bridge,/run\.parts\.size>=run\.expected/);
assert.match(diagnosticUi,/Rejected Lens candidates/);
assert.match(diagnosticUi,/viewing this saved diagnostic uses no provider credits/);
assert.match(page,/20 reviews in Test or 50 in Balanced\/Thorough/);
assert.match(page,/\/api\/generation-plan/);
assert.match(page,/runQualityPipeline/);
assert.match(page,/corpusQualitySignals/);
assert.match(page,/syntheticReviewCsv/);
assert.match(page,/syntheticReviewBulkCsv/);

console.log(JSON.stringify({ok:true,budgets:{test,balanced,thorough},diverseHosts:hosts,retailerFamilies:retailerSelected.map(candidateFamily),uniqueReferenceCount:refs.length,maxActiveWorkers},null,2));

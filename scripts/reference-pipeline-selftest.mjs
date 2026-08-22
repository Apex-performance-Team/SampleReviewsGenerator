import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{candidateHost,referenceBudget,selectDiverseCandidates,uniqueReferences}from'../lib/reference-pipeline.mjs';

const test=referenceBudget('test'),balanced=referenceBudget('balanced'),thorough=referenceBudget('thorough');
assert.deepEqual([test.maxImages,test.maxAmazonQueries,test.maxMarketplaceReviews],[1,1,50]);
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

const refs=uniqueReferences([
  {referenceId:'1',sourceBody:'Works very well.'},
  {referenceId:'2',sourceBody:'Works VERY well!!!'},
  {referenceId:'3',sourceBody:'Setup took about five minutes.'}
]);
assert.deepEqual(refs.map(x=>x.referenceId),['1','3']);

const transport=await readFile(new URL('../lib/bright-lens-native.js',import.meta.url),'utf8'),layout=await readFile(new URL('../app/layout.js',import.meta.url),'utf8'),lensRoute=await readFile(new URL('../app/api/reference-scan-v11/route.js',import.meta.url),'utf8'),amazonDiscovery=await readFile(new URL('../lib/amazon-volume-discovery-v2.js',import.meta.url),'utf8');
assert.match(transport,/x-unblock-data-format'\s*:\s*'parsed_light'/);
assert.match(transport,/headers=\{'x-brd-session':upload\.session,'x-unblock-data-format':'parsed_light'\}/);
assert.doesNotMatch(layout,/MarketplaceEnrichmentBridge/);
assert.match(lensRoute,/resize\(512,512/);
assert.match(amazonDiscovery,/resize\(512,512/);

console.log(JSON.stringify({ok:true,budgets:{test,balanced,thorough},diverseHosts:hosts,uniqueReferenceCount:refs.length},null,2));

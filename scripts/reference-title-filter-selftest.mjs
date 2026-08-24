import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{assessReferenceTitleCompatibility,filterReferencesByProductTitle}from'../lib/reference-title-compatibility.mjs';

const outdoor='InstaBeam OmniReach Extended Range TV Antenna';
const incompatible=[
  {referenceId:'INDOOR-1',sourceBody:'The included double-sided tape held the flat antenna to my living-room window.'},
  {referenceId:'INDOOR-2',sourceBody:'I put the thin and flimsy antenna behind our TV in the apartment.'},
  {referenceId:'INDOOR-3',sourceReviewProductTitle:'Premium Indoor Flat HDTV Antenna',sourceBody:'Reception was fine.'},
];
const compatible=[
  {referenceId:'OUTDOOR-1',sourceBody:'Mounted it on the roof and the mast hardware felt straightforward.'},
  {referenceId:'OUTDOOR-2',sourceReviewProductTitle:'1byone Outdoor TV Antenna 360° Omni-Directional Reception',sourceBody:'Reception improved after installation.'},
  {referenceId:'OUTDOOR-3',sourceBody:'The reception is steadier than with my previous antenna.'},
];

for(const reference of incompatible)assert.equal(assessReferenceTitleCompatibility(outdoor,reference).accepted,false,reference.referenceId);
for(const reference of compatible)assert.equal(assessReferenceTitleCompatibility(outdoor,reference).accepted,true,reference.referenceId);
assert.equal(assessReferenceTitleCompatibility('Premium Indoor HDTV Antenna',{sourceBody:'Mounted outdoors on the roof mast.'}).accepted,false);
assert.equal(assessReferenceTitleCompatibility('Ceramic Coffee Mug',{sourceBody:'Keeps my morning coffee warm.'}).accepted,true);

const filtered=filterReferencesByProductTitle(outdoor,[...incompatible,...compatible]);
assert.deepEqual(filtered.accepted.map(x=>x.referenceId),['OUTDOOR-1','OUTDOOR-2','OUTDOOR-3']);
assert.equal(filtered.diagnostics.rejectedCount,3);
assert.equal(filtered.diagnostics.version,'shopify-product-title-v1');
const amazonIngestSource=readFileSync(new URL('../lib/amazon-review-ingest-v2.js',import.meta.url),'utf8');
assert.match(amazonIngestSource,/name:'exact_variant',variationSpecific:true/);
assert.match(amazonIngestSource,/name:'listing_family',variationSpecific:false/);
console.log('reference title filter self-test passed');

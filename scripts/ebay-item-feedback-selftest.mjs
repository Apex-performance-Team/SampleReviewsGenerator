import assert from'node:assert/strict';
import{parseEbayItemFeedback,selectBrightUnlockerZone}from'../lib/marketplace-review-ingest.js';

const html=`
<div id=item-tabpanel-0 aria-labelledby=item-tabs-0 role=tabpanel>
  <div data-track='{"fdbk_tab":"ITEM"}' action='{"URL":"?page_id_item=1&page_type=FILTER_ITEM"}'></div>
  <ul>
    <li class=fdbk-container>
      <div class=fdbk-container__details__info__username><span>eBay automated feedback</span></div>
      <span class=fdbk-container__details__info__divide__time><span>Past month</span></span>
      <div class=fdbk-container__details__comment><span>Order delivered on time with no issues</span></div>
    </li>
    <li class=fdbk-container>
      <div class=fdbk-container__details__info__username><span>b***r (42)</span><span>- Feedback left by buyer.</span></div>
      <span class=fdbk-container__details__info__divide__time><span>Past year</span></span>
      <div class=fdbk-container__details__verified__purchase><span>Verified purchase</span></div>
      <div class=fdbk-container__details__comment><span>This exact antenna works well in our remote area.</span></div>
    </li>
  </ul>
</div>
<div id=item-tabpanel-1 aria-labelledby=item-tabs-1 role=tabpanel>
  <li class=fdbk-container>
    <div class=fdbk-container__details__info__username><span>seller-wide-buyer</span></div>
    <div class=fdbk-container__details__comment><span>This belongs to a completely different item.</span></div>
  </li>
</div>`;

const result=parseEbayItemFeedback(html);
assert.equal(result.cardCount,2);
assert.equal(result.automatedExcluded,1);
assert.equal(result.reviews.length,1);
assert.equal(result.reviews[0].body,'This exact antenna works well in our remote area.');
assert.equal(result.reviews[0].authorName,'b***r (42)');
assert.equal(result.reviews[0].reviewDate,'Past year');
assert.equal(result.reviews[0].verifiedPurchase,true);
assert.ok(!result.reviews.some(x=>x.body.includes('different item')));
assert.deepEqual(selectBrightUnlockerZone([{name:'search-zone',type:'serp'},{name:'unlock-zone',type:'unblocker'}]),{zone:'unlock-zone',source:'auto_detected'});
assert.deepEqual(selectBrightUnlockerZone([{name:'first-unlock',type:'unblocker'},{name:'preferred-unlock',type:'web_unlocker'}],'preferred-unlock'),{zone:'preferred-unlock',source:'environment'});
assert.equal(selectBrightUnlockerZone([{name:'search-zone',type:'serp'}]),null);

console.log(JSON.stringify({ok:true,itemCards:result.cardCount,automatedExcluded:result.automatedExcluded,accepted:result.reviews.length,sellerWideAccepted:0}));

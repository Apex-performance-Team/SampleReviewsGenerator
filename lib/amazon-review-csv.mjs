const text=value=>value==null?'':String(value);

export function csvCell(value){
  return `"${text(value).replace(/"/g,'""')}"`;
}

export function amazonReviewRows({reviews=[],source={},result={},control={},balance={}}={}){
  const snapshotIds=(result.batches||[]).map(x=>x?.snapshotId).filter(Boolean).join('|');
  const returned=Math.min(reviews.length,Number(control.maxReviews)||reviews.length);
  return reviews.slice(0,returned).map((review,index)=>({
    export_index:index+1,
    source_platform:source.platform||'amazon.com',
    source_listing_url:result.canonicalUrl||source.directSourceUrl||source.sourceUrl||'',
    asin:source.asin||'',
    review_id:review.reviewId||'',
    author_name:review.authorName||'',
    verified_purchase:Boolean(review.verifiedPurchase),
    review_date:review.reviewDate||'',
    rating:review.rating??'',
    review_title:review.title||'',
    review_body:review.body||'',
    probe_requested_reviews:Number(control.maxReviews)||'',
    probe_exported_reviews:returned,
    probe_max_batches:Number(control.maxBatches)||'',
    bright_data_trigger_count:Number(result.attempted)||0,
    bright_data_snapshot_id:snapshotIds,
    bright_data_balance_before:balance.before??'',
    bright_data_balance_after:balance.after??'',
    bright_data_balance_delta:balance.delta??'',
    bright_data_pending_before:balance.pendingBefore??'',
    bright_data_pending_after:balance.pendingAfter??''
  }));
}

export function amazonReviewsToCsv(input={}){
  const rows=amazonReviewRows(input);
  if(!rows.length)return'';
  const headers=Object.keys(rows[0]);
  return '\ufeff'+[headers.map(csvCell).join(','),...rows.map(row=>headers.map(header=>csvCell(row[header])).join(','))].join('\r\n')+'\r\n';
}

const clean=value=>String(value??'').replace(/\s+/g,' ').trim();

function amazonAsin(raw){
  const value=clean(raw),explicit=value.match(/\/(?:dp|gp\/product|product-reviews|clp)\/([A-Z0-9]{10})(?:[/?#]|$)/i)?.[1];
  if(explicit)return explicit.toUpperCase();
  const standalone=value.match(/(?:^|[^A-Z0-9])([A-Z0-9]{10})(?:[^A-Z0-9]|$)/i)?.[1];
  return standalone&&/^B[A-Z0-9]{9}$/i.test(standalone)?standalone.toUpperCase():null;
}

function sourceKey(source){
  const asin=clean(source?.asin||amazonAsin(source?.directSourceUrl||source?.sourceUrl)).toUpperCase();
  if(asin)return`amazon:${asin}`;
  return clean(source?.directSourceUrl||source?.sourceUrl).toLowerCase();
}

function usefulTitle(value){
  const title=clean(value);
  return title&&!/^amazon$|^user-supplied amazon listing$/i.test(title)?title:'';
}

export function createManualAmazonSeed({amazonListingUrl,productTitle,productUrl}={},budget=null){
  const raw=clean(amazonListingUrl);
  if(!raw)return null;
  const asin=amazonAsin(raw);
  if(!asin)throw Error('Known Amazon listing must contain a valid 10-character ASIN.');
  const sourceUrl=`https://www.amazon.com/dp/${asin}`,title=clean(productTitle)||'Verified Amazon product listing';
  return{asin,sourceUrl,source:{platform:'amazon.com',provider:'user_supplied_amazon_listing',sourceUrl,directSourceUrl:sourceUrl,asin,title,status:'aggregate_only',matchConfidence:1,confidence:'high',publicReviewCount:null,extractedReviewCount:0,individualExtractedCount:0,pageCount:1,aggregateOnly:true,ratingEstimate:null,error:null,linkVerified:true,linkVerification:'user_supplied_amazon_listing',lensTabs:['manual_amazon_seed'],lensRank:null,verificationMethod:'user_supplied_amazon_listing',verificationReason:'Verified Amazon listing supplied as a trusted seed; Lens and marketplace discovery still run for additional sources.',discoveryOrigin:'manual_verified_amazon',manualSeed:true},metadata:{asin,sourceUrl,productUrl:clean(productUrl)||null,budgetId:budget?.id||null}};
}

export function mergeManualAmazonSeed(referenceSet,seed){
  if(!referenceSet||!seed)return referenceSet;
  const rows=[...(referenceSet.sourceCounts||[])],key=sourceKey(seed.source),index=rows.findIndex(row=>sourceKey(row)===key),mergedIntoExisting=index>=0;
  if(mergedIntoExisting){
    const current=rows[index],title=usefulTitle(current.title)||seed.source.title;
    rows[index]={...seed.source,...current,title,asin:current.asin||seed.asin,sourceUrl:current.sourceUrl||seed.sourceUrl,directSourceUrl:current.directSourceUrl||seed.sourceUrl,matchConfidence:Math.max(1,Number(current.matchConfidence)||0),confidence:'high',linkVerified:true,linkVerification:current.linkVerification||seed.source.linkVerification,verificationMethod:current.verificationMethod||seed.source.verificationMethod,verificationReason:current.verificationReason||seed.source.verificationReason,manualSeed:true};
  }else rows.push({...seed.source});
  const verifiedSourceLinks=rows.filter(row=>row?.linkVerified).length;
  return{...referenceSet,sourceCounts:rows,confidence:'high',matchedPages:rows.length,verifiedSourceLinks,lensDiscovery:{...(referenceSet.lensDiscovery||{}),manualSeedIncluded:true,manualSeedAsin:seed.asin},provenance:{...(referenceSet.provenance||{}),manualAmazonListing:true,manualAmazonSeed:true,amazonListingUrl:seed.sourceUrl},manualAmazonSeed:{...seed.metadata,mergedIntoExisting}};
}
